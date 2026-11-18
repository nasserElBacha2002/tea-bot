import { createHash, randomUUID } from 'node:crypto';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import twilioWhatsAppService from './twilio-whatsapp.service.js';
import { withTransaction, query } from '../db/index.js';
import { agentsMatch } from '../utils/agent-identity.js';
import { mapConversationPublic, mapMessagePublic } from '../utils/conversation-inbox.mapper.js';
import { notifyConversationMessageCreated } from '../realtime/conversation-live.notify.js';
import twilioMessageDeliveryService from './twilio-message-delivery.service.js';
import {
  buildTwilioMediaUrlForStoredObject,
  discardStoredOutboundAttachment,
  parseAgentOutboundAttachment,
  storePreparedOutboundAttachment,
} from './outbound-agent-media.service.js';

const AGENT_SEND_OPERATION = 'agent_send_message';
export const OUTBOUND_DELIVERY_STATES = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  UNCERTAIN: 'uncertain',
};

const DEFAULT_MAX_BATCH = 5;
const DEFAULT_DISPATCH_LEASE_MS = 2 * 60 * 1000;

function dispatchLeaseMs() {
  const parsed = Number(process.env.OUTBOUND_DISPATCH_LEASE_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DISPATCH_LEASE_MS;
  return Math.min(Math.floor(parsed), 10 * 60 * 1000);
}

function appError(code, message, httpStatus = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.apiError = code;
  err.apiMessage = message;
  if (details) err.details = details;
  return err;
}

function isUniqueViolation(error) {
  return error?.number === 2627 || error?.number === 2601;
}

function normalizeClientRequestId(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 80) return null;
  return value;
}

export function maxOutboundBatchSize() {
  const parsed = Number(process.env.INBOX_OUTBOUND_MAX_ATTACHMENTS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BATCH;
  return Math.min(Math.floor(parsed), DEFAULT_MAX_BATCH);
}

export function hashAgentSendPayload({ body = '', attachmentSha256 = '' } = {}) {
  const seed = `${String(body || '').trim()}\n${String(attachmentSha256 || '')}`;
  return createHash('sha256').update(seed).digest('hex');
}

async function findAgentSendOperation(conversationId, clientRequestId, { transaction } = {}) {
  const { rows } = await query(
    `SELECT TOP (1) actor_agent_id, request_hash
     FROM dbo.conversation_operation_requests
     WHERE conversation_id = $1 AND operation = $2 AND client_request_id = $3`,
    [conversationId, AGENT_SEND_OPERATION, clientRequestId],
    { transaction },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    actorAgentId: row.actor_agent_id,
    requestHash: row.request_hash,
  };
}

async function insertAgentSendOperation(entry, { transaction } = {}) {
  await query(
    `INSERT INTO dbo.conversation_operation_requests (
      conversation_id, operation, client_request_id, actor_agent_id, request_hash
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.conversationId,
      AGENT_SEND_OPERATION,
      entry.clientRequestId,
      entry.actorAgentId,
      entry.requestHash,
    ],
    { transaction },
  );
}

function outboundDeliveryMeta(base, patch) {
  return {
    ...(base || {}),
    outboundDelivery: {
      ...(base?.outboundDelivery || {}),
      ...patch,
    },
  };
}

async function expireStaleOutboundDispatchLeases(messageId) {
  await query(
    `UPDATE dbo.conversation_messages
     SET metadata_json = JSON_MODIFY(
       JSON_MODIFY(
         JSON_MODIFY(
           JSON_MODIFY(metadata_json, '$.outboundDelivery.state', 'uncertain'),
           '$.outboundDelivery.dispatching', 'false'
         ),
         '$.outboundDelivery.error', 'dispatch_lease_expired'
       ),
       '$.outboundDelivery.dispatchLeaseUntil', NULL
     )
     WHERE id = $1
       AND ISJSON(metadata_json) = 1
       AND JSON_VALUE(metadata_json, '$.outboundDelivery.state') = 'pending'
       AND JSON_VALUE(metadata_json, '$.outboundDelivery.dispatching') = 'true'
       AND TRY_CONVERT(datetime2, JSON_VALUE(metadata_json, '$.outboundDelivery.dispatchLeaseUntil')) < SYSUTCDATETIME()`,
    [messageId],
  );
}

/**
 * Arrienda exclusivamente el despacho Twilio de un mensaje pending/failed (sin transacción abierta).
 */
async function tryAcquireOutboundDispatchLease(messageId, workerId) {
  await expireStaleOutboundDispatchLeases(messageId);
  const leaseUntil = new Date(Date.now() + dispatchLeaseMs()).toISOString();
  const { rows } = await query(
    `DECLARE @updated TABLE (id UNIQUEIDENTIFIER);
     UPDATE dbo.conversation_messages
     SET metadata_json = JSON_MODIFY(
       JSON_MODIFY(
         JSON_MODIFY(
           JSON_MODIFY(
             JSON_MODIFY(metadata_json, '$.outboundDelivery.dispatching', 'true'),
             '$.outboundDelivery.dispatchWorkerId', $2
           ),
           '$.outboundDelivery.dispatchLeaseUntil', $3
         ),
         '$.outboundDelivery.dispatchAttempts',
         COALESCE(TRY_CONVERT(int, JSON_VALUE(metadata_json, '$.outboundDelivery.dispatchAttempts')), 0) + 1
       ),
       '$.outboundDelivery.state',
       CASE
         WHEN JSON_VALUE(metadata_json, '$.outboundDelivery.state') = 'failed' THEN 'pending'
         ELSE JSON_VALUE(metadata_json, '$.outboundDelivery.state')
       END
     )
     OUTPUT INSERTED.id INTO @updated
     WHERE id = $1
       AND ISJSON(metadata_json) = 1
       AND JSON_VALUE(metadata_json, '$.outboundDelivery.state') IN (N'pending', N'failed')
       AND COALESCE(JSON_VALUE(metadata_json, '$.outboundDelivery.dispatching'), N'false') = N'false';
     SELECT id FROM @updated;`,
  [messageId, workerId, leaseUntil],
  );
  return Boolean(rows[0]?.id);
}

async function loadMessageForClientRequest(conversationId, clientRequestId, { transaction } = {}) {
  const { rows } = await query(
    `SELECT TOP (1) *
     FROM dbo.conversation_messages
     WHERE conversation_id = $1
       AND ISJSON(metadata_json) = 1
       AND JSON_VALUE(metadata_json, '$.clientRequestId') = $2
     ORDER BY created_at DESC`,
    [conversationId, clientRequestId],
    { transaction },
  );
  return conversationMessageRepository.findById(rows[0]?.id, { transaction });
}

function mapPublicResult(conversation, message, attachments = []) {
  return {
    ok: true,
    message: mapMessagePublic(message, { attachments }),
    conversation: mapConversationPublic(conversation),
    idempotent: false,
  };
}

export function twilioOutcomeFromError(error) {
  if (error?.code === 'TWILIO_SEND_FAILED') {
    return { state: OUTBOUND_DELIVERY_STATES.FAILED, retryable: true };
  }
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND') {
    return { state: OUTBOUND_DELIVERY_STATES.UNCERTAIN, retryable: false };
  }
  return { state: OUTBOUND_DELIVERY_STATES.FAILED, retryable: Boolean(error?.code === 'TWILIO_SEND_FAILED') };
}

class AgentOutboundSendService {
  async sendSingleItem(ctx, {
    body = '',
    attachment = null,
    clientRequestId = null,
    includeBody = true,
    batchClientRequestId = null,
  } = {}) {
    const trimmedBody = includeBody ? String(body || '').trim() : '';
    const preparedAttachment = attachment ? parseAgentOutboundAttachment(attachment) : null;
    if (!trimmedBody && !preparedAttachment) {
      throw appError('EMPTY_BODY', 'El mensaje no puede estar vacío', 400);
    }
    const normalizedRequestId = normalizeClientRequestId(clientRequestId);
    if (!normalizedRequestId) {
      throw appError('CLIENT_REQUEST_ID_REQUIRED', 'clientRequestId es obligatorio para envíos con adjunto', 400);
    }
    const requestHash = hashAgentSendPayload({
      body: trimmedBody,
      attachmentSha256: preparedAttachment?.sha256 || '',
    });

    const replay = await this._loadSuccessfulReplay(ctx, normalizedRequestId, requestHash);
    if (replay) {
      return {
        ok: true,
        message: replay.message,
        conversation: replay.conversation,
        idempotent: true,
        error: null,
        deliveryState: OUTBOUND_DELIVERY_STATES.CONFIRMED,
      };
    }

    await this._guardUncertainOrConflict(ctx, normalizedRequestId, requestHash);

    let stagedStorage = null;
    const preReserved = await this._findReservedOutbound(ctx, normalizedRequestId, requestHash);

    let persisted;
    if (preReserved) {
      persisted = preReserved;
    } else {
      if (preparedAttachment) {
        stagedStorage = await storePreparedOutboundAttachment(preparedAttachment);
      }
      try {
        persisted = await this._persistReservedOutbound(ctx, {
          clientRequestId: normalizedRequestId,
          batchClientRequestId,
          requestHash,
          trimmedBody,
          includeBody,
          preparedAttachment,
          stagedStorage,
          provider: ctx.conversation.provider,
        });
      } catch (error) {
        if (stagedStorage) {
          await discardStoredOutboundAttachment(stagedStorage.root, stagedStorage.storageKey);
        }
        throw error;
      }
      if (stagedStorage && !persisted.created) {
        await discardStoredOutboundAttachment(stagedStorage.root, stagedStorage.storageKey);
        stagedStorage = null;
      }
    }

    const twilioBody = persisted.message?.metadataJson?.outboundDelivery?.includeBody
      ? String(persisted.message.body || '').trim()
      : trimmedBody;

    const deliver = await this._deliverReservedMessage(ctx, persisted, {
      trimmedBody: twilioBody,
    });

    if (deliver.notify) {
      notifyConversationMessageCreated(deliver.conversation, deliver.mappedMessage);
    }

    return {
      ok: deliver.ok,
      message: deliver.mappedMessage,
      conversation: mapConversationPublic(deliver.conversation),
      idempotent: deliver.idempotent,
      error: deliver.error || null,
      deliveryState: deliver.deliveryState,
    };
  }

  async sendBatch(ctx, { body = '', attachments = [], batchClientRequestId = null } = {}) {
    const items = Array.isArray(attachments) ? attachments : [];
    if (!items.length) {
      throw appError('EMPTY_BATCH', 'No hay archivos para enviar', 400);
    }
    if (items.length > maxOutboundBatchSize()) {
      throw appError('BATCH_TOO_LARGE', `Máximo ${maxOutboundBatchSize()} archivos por envío`, 400);
    }

    const trimmedBody = String(body || '').trim();
    const normalizedBatchId = normalizeClientRequestId(batchClientRequestId) || null;
    const results = [];
    let lastConversation = ctx.conversation;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] || {};
      const clientRequestId = normalizeClientRequestId(item.clientRequestId);
      if (!clientRequestId) {
        results.push({
          clientRequestId: null,
          ok: false,
          error: { code: 'CLIENT_REQUEST_ID_REQUIRED', message: 'clientRequestId es obligatorio por archivo' },
        });
        continue;
      }
      try {
        const itemIncludeBody = item.includeBody === true || (
          item.includeBody !== false && index === 0
        );
        const result = await this.sendSingleItem(ctx, {
          body: trimmedBody,
          attachment: item,
          clientRequestId,
          includeBody: itemIncludeBody,
          batchClientRequestId: normalizedBatchId,
        });
        lastConversation = result.conversation || lastConversation;
        results.push({
          clientRequestId,
          ok: result.ok,
          message: result.message,
          idempotent: result.idempotent,
          deliveryState: result.deliveryState,
          error: result.error,
        });
      } catch (error) {
        results.push({
          clientRequestId,
          ok: false,
          error: {
            code: error.code || error.apiError || 'SEND_FAILED',
            message: error.apiMessage || error.message,
          },
        });
      }
    }

    const successCount = results.filter((row) => row.ok).length;
    return {
      results,
      partial: successCount > 0 && successCount < results.length,
      allSucceeded: successCount === results.length,
      conversation: mapConversationPublic(lastConversation),
    };
  }

  async sendTextOnly(ctx, { body, clientRequestId = null } = {}) {
    const trimmed = String(body || '').trim();
    if (!trimmed) throw appError('EMPTY_BODY', 'El mensaje no puede estar vacío', 400);
    const normalizedRequestId = normalizeClientRequestId(clientRequestId);
    if (normalizedRequestId) {
      const result = await this.sendSingleItem(ctx, {
        body: trimmed,
        clientRequestId: normalizedRequestId,
        includeBody: true,
      });
      if (!result.ok) {
        throw appError(
          result.error?.code || 'TWILIO_SEND_FAILED',
          result.error?.message || 'No se pudo enviar el mensaje.',
          502,
        );
      }
      return {
        message: result.message,
        conversation: result.conversation,
        idempotent: result.idempotent,
      };
    }
    return this._sendTextWithoutOperation(ctx, trimmed);
  }

  async _sendTextWithoutOperation(ctx, trimmed) {
    let persisted;
    persisted = {
      message: await conversationMessageRepository.createMessage({
        conversationId: ctx.conversation.id,
        direction: 'outbound',
        senderType: 'agent',
        body: trimmed,
        provider: ctx.conversation.provider,
        providerMessageId: null,
        metadataJson: {
          generatedBy: 'agent_inbox',
          agentId: ctx.actorAgentId,
          outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.PENDING, includeBody: true },
        },
      }),
      attachmentRow: null,
      conversation: ctx.conversation,
      created: true,
    };
    const deliver = await this._deliverReservedMessage(ctx, persisted, { trimmedBody: trimmed });
    if (deliver.notify) {
      notifyConversationMessageCreated(deliver.conversation, deliver.mappedMessage);
    }
    return {
      message: deliver.mappedMessage,
      conversation: mapConversationPublic(deliver.conversation),
      idempotent: deliver.idempotent,
    };
  }

  async _guardUncertainOrConflict(ctx, clientRequestId, requestHash) {
    const existing = await findAgentSendOperation(ctx.conversation.id, clientRequestId);
    if (!existing) return;
    if (!agentsMatch(existing.actorAgentId, ctx.actorAgentId)) {
      throw appError('FORBIDDEN', 'No tenés permiso para reutilizar esta solicitud.', 403);
    }
    if (existing.requestHash !== requestHash) {
      throw appError(
        'IDEMPOTENCY_CONFLICT',
        'Ese identificador de solicitud ya fue usado con otros datos.',
        409,
      );
    }
    const message = await loadMessageForClientRequest(ctx.conversation.id, clientRequestId);
    if (!message) return;
    const state = message.metadataJson?.outboundDelivery?.state;
    if (state === OUTBOUND_DELIVERY_STATES.UNCERTAIN) {
      throw appError(
        'OUTBOUND_UNCERTAIN',
        'El envío quedó en estado incierto. No se reintenta automáticamente.',
        409,
        { messageId: message.id },
      );
    }
  }

  async _loadSuccessfulReplay(ctx, clientRequestId, requestHash) {
    const existing = await findAgentSendOperation(ctx.conversation.id, clientRequestId);
    if (!existing) return null;
    if (!agentsMatch(existing.actorAgentId, ctx.actorAgentId)) {
      throw appError('FORBIDDEN', 'No tenés permiso para reutilizar esta solicitud.', 403);
    }
    if (existing.requestHash !== requestHash) {
      throw appError(
        'IDEMPOTENCY_CONFLICT',
        'Ese identificador de solicitud ya fue usado con otros datos.',
        409,
      );
    }
    const message = await loadMessageForClientRequest(ctx.conversation.id, clientRequestId);
    if (!message) return null;
    const state = message.metadataJson?.outboundDelivery?.state;
    if (state === OUTBOUND_DELIVERY_STATES.CONFIRMED || message.providerMessageId) {
      const attachments = await attachmentRepository.findByMessageId(message.id);
      return mapPublicResult(ctx.conversation, message, attachments);
    }
    return null;
  }

  async _findReservedOutbound(ctx, clientRequestId, requestHash) {
    const existing = await findAgentSendOperation(ctx.conversation.id, clientRequestId);
    if (!existing) return null;
    if (!agentsMatch(existing.actorAgentId, ctx.actorAgentId)) {
      throw appError('FORBIDDEN', 'No tenés permiso para reutilizar esta solicitud.', 403);
    }
    if (existing.requestHash !== requestHash) {
      throw appError(
        'IDEMPOTENCY_CONFLICT',
        'Ese identificador de solicitud ya fue usado con otros datos.',
        409,
      );
    }
    const message = await loadMessageForClientRequest(ctx.conversation.id, clientRequestId);
    if (!message) return null;
    const state = message.metadataJson?.outboundDelivery?.state;
    if (state === OUTBOUND_DELIVERY_STATES.CONFIRMED || message.providerMessageId) {
      return null;
    }
    if (state === OUTBOUND_DELIVERY_STATES.UNCERTAIN) {
      throw appError(
        'OUTBOUND_UNCERTAIN',
        'El envío quedó en estado incierto. No se reintenta automáticamente.',
        409,
        { messageId: message.id },
      );
    }
    const attachments = await attachmentRepository.findByMessageId(message.id);
    return {
      message,
      attachmentRow: attachments[0] || null,
      conversation: ctx.conversation,
      created: false,
    };
  }

  async _persistReservedOutbound(ctx, input) {
    return withTransaction(async (transaction) => {
      const reserved = await this._reserveOperation(ctx, input, { transaction });
      if (reserved.replayMessage) return reserved.replayMessage;

      const message = await conversationMessageRepository.createMessage({
        conversationId: ctx.conversation.id,
        direction: 'outbound',
        senderType: 'agent',
        body: input.trimmedBody,
        provider: input.provider,
        providerMessageId: null,
        metadataJson: {
          generatedBy: 'agent_inbox',
          agentId: ctx.actorAgentId,
          clientRequestId: input.clientRequestId,
          batchClientRequestId: input.batchClientRequestId || undefined,
          hasAttachment: Boolean(input.preparedAttachment),
          outboundDelivery: {
            state: OUTBOUND_DELIVERY_STATES.PENDING,
            requestHash: input.requestHash,
            includeBody: Boolean(input.includeBody && input.trimmedBody),
          },
        },
      }, { transaction });

      let attachmentRow = null;
      if (input.preparedAttachment && input.stagedStorage) {
        attachmentRow = await attachmentRepository.insertStored({
          messageId: message.id,
          conversationId: ctx.conversation.id,
          mimeType: input.preparedAttachment.mimeType,
          byteSize: input.preparedAttachment.byteSize,
          originalName: input.preparedAttachment.originalName,
          storageKey: input.stagedStorage.storageKey,
          sha256: input.preparedAttachment.sha256,
        }, { transaction });
      }

      const conversation = await ctx.touchConversationInTransaction(
        ctx.conversation.id,
        ctx,
        { transaction },
      );

      return {
        message,
        attachmentRow,
        conversation,
        created: true,
      };
    });
  }

  async _reserveOperation(ctx, input, { transaction } = {}) {
    const existing = await findAgentSendOperation(
      ctx.conversation.id,
      input.clientRequestId,
      { transaction },
    );
    if (existing) {
      if (!agentsMatch(existing.actorAgentId, ctx.actorAgentId)) {
        throw appError('FORBIDDEN', 'No tenés permiso para reutilizar esta solicitud.', 403);
      }
      if (existing.requestHash !== input.requestHash) {
        throw appError(
          'IDEMPOTENCY_CONFLICT',
          'Ese identificador de solicitud ya fue usado con otros datos.',
          409,
        );
      }
      const message = await loadMessageForClientRequest(
        ctx.conversation.id,
        input.clientRequestId,
        { transaction },
      );
      if (!message) {
        throw appError('OUTBOUND_INCONSISTENT', 'Reserva sin mensaje persistido', 500);
      }
      const attachments = await attachmentRepository.findByMessageId(message.id, { transaction });
      return {
        replayMessage: {
          message,
          attachmentRow: attachments[0] || null,
          conversation: ctx.conversation,
          created: false,
        },
      };
    }

    try {
      await insertAgentSendOperation({
        conversationId: ctx.conversation.id,
        clientRequestId: input.clientRequestId,
        actorAgentId: ctx.actorAgentId,
        requestHash: input.requestHash,
      }, { transaction });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await findAgentSendOperation(
        ctx.conversation.id,
        input.clientRequestId,
        { transaction },
      );
      if (!raced) {
        throw appError(
          'OUTBOUND_IN_PROGRESS',
          'Otro envío con el mismo identificador está en curso.',
          409,
        );
      }
      if (!agentsMatch(raced.actorAgentId, ctx.actorAgentId)) {
        throw appError('FORBIDDEN', 'No tenés permiso para reutilizar esta solicitud.', 403);
      }
      if (raced.requestHash !== input.requestHash) {
        throw appError(
          'IDEMPOTENCY_CONFLICT',
          'Ese identificador de solicitud ya fue usado con otros datos.',
          409,
        );
      }
      const message = await loadMessageForClientRequest(
        ctx.conversation.id,
        input.clientRequestId,
        { transaction },
      );
      if (!message) {
        throw appError('OUTBOUND_IN_PROGRESS', 'Otro envío con el mismo identificador está en curso.', 409);
      }
      const attachments = await attachmentRepository.findByMessageId(message.id, { transaction });
      return {
        replayMessage: {
          message,
          attachmentRow: attachments[0] || null,
          conversation: ctx.conversation,
          created: false,
        },
      };
    }

    return { replayMessage: null };
  }

  async _deliverReservedMessage(ctx, persisted, { trimmedBody }) {
    const attachmentRows = persisted.attachmentRow ? [persisted.attachmentRow] : [];
    let liveMessage = await conversationMessageRepository.findById(persisted.message.id);
    const deliveryState = liveMessage?.metadataJson?.outboundDelivery?.state;
    if (liveMessage?.providerMessageId || deliveryState === OUTBOUND_DELIVERY_STATES.CONFIRMED) {
      if (liveMessage?.providerMessageId) {
        await twilioMessageDeliveryService.syncDeliveryAfterOutboundLink(liveMessage);
      }
      return {
        ok: true,
        idempotent: true,
        deliveryState: OUTBOUND_DELIVERY_STATES.CONFIRMED,
        mappedMessage: mapMessagePublic(liveMessage, { attachments: attachmentRows }),
        conversation: persisted.conversation,
        notify: false,
      };
    }
    if (deliveryState === OUTBOUND_DELIVERY_STATES.UNCERTAIN) {
      throw appError(
        'OUTBOUND_UNCERTAIN',
        'El envío quedó en estado incierto. No se reintenta automáticamente.',
        409,
        { messageId: liveMessage.id },
      );
    }

    const mappedPending = mapMessagePublic(liveMessage, { attachments: attachmentRows });

    const isSeed = await this._isSeedConversation(ctx.conversation.id);
    if (!this._shouldCallTwilio(ctx.conversation, isSeed)) {
      const confirmed = await this._finalizeDelivery(persisted.message.id, {
        providerMessageId: null,
        state: OUTBOUND_DELIVERY_STATES.CONFIRMED,
      });
      return {
        ok: true,
        idempotent: !persisted.created,
        deliveryState: OUTBOUND_DELIVERY_STATES.CONFIRMED,
        mappedMessage: mapMessagePublic(confirmed, { attachments: attachmentRows }),
        conversation: persisted.conversation,
        notify: persisted.created,
      };
    }

    const workerId = randomUUID();
    const acquired = await this._acquireDispatchLease(persisted.message.id, workerId);
    if (!acquired) {
      const refreshed = await conversationMessageRepository.findById(persisted.message.id);
      const refreshState = refreshed?.metadataJson?.outboundDelivery?.state;
      if (refreshState === OUTBOUND_DELIVERY_STATES.UNCERTAIN) {
        throw appError(
          'OUTBOUND_UNCERTAIN',
          'El envío quedó en estado incierto. No se reintenta automáticamente.',
          409,
          { messageId: persisted.message.id },
        );
      }
      if (refreshed?.providerMessageId || refreshState === OUTBOUND_DELIVERY_STATES.CONFIRMED) {
        if (refreshed?.providerMessageId) {
          await twilioMessageDeliveryService.syncDeliveryAfterOutboundLink(refreshed);
        }
        const attachments = attachmentRows.length
          ? attachmentRows
          : await attachmentRepository.findByMessageId(persisted.message.id);
        return {
          ok: true,
          idempotent: true,
          deliveryState: OUTBOUND_DELIVERY_STATES.CONFIRMED,
          mappedMessage: mapMessagePublic(refreshed, { attachments }),
          conversation: persisted.conversation,
          notify: false,
        };
      }
      throw appError(
        'OUTBOUND_IN_PROGRESS',
        'Otro envío con el mismo identificador está en curso.',
        409,
        { messageId: persisted.message.id },
      );
    }

    let mediaUrl = null;
    const attachmentRow = persisted.attachmentRow;
    if (attachmentRow?.storageKey && attachmentRow?.mimeType) {
      mediaUrl = buildTwilioMediaUrlForStoredObject(attachmentRow.storageKey, attachmentRow.mimeType);
    }

    let providerMessageId = null;
    let nextDeliveryState = OUTBOUND_DELIVERY_STATES.CONFIRMED;
    let error = null;
    try {
      providerMessageId = await this._callTwilio(ctx.conversation.phoneNumber, {
        body: trimmedBody,
        mediaUrl,
      });
    } catch (twilioError) {
      const outcome = twilioOutcomeFromError(twilioError);
      nextDeliveryState = outcome.state;
      error = {
        code: twilioError.code || twilioError.apiError || 'TWILIO_SEND_FAILED',
        message: twilioError.apiMessage || twilioError.message,
        retryable: outcome.retryable,
      };
      await this._finalizeDelivery(persisted.message.id, {
        providerMessageId: null,
        state: nextDeliveryState,
        error: error.message,
      });
      return {
        ok: false,
        idempotent: !persisted.created,
        deliveryState: nextDeliveryState,
        mappedMessage: mappedPending,
        conversation: persisted.conversation,
        notify: false,
        error,
      };
    }

    try {
      const confirmed = await this._finalizeDelivery(persisted.message.id, {
        providerMessageId,
        state: nextDeliveryState,
      });
      return {
        ok: true,
        idempotent: !persisted.created,
        deliveryState: nextDeliveryState,
        mappedMessage: mapMessagePublic(confirmed, { attachments: attachmentRows }),
        conversation: persisted.conversation,
        notify: true,
      };
    } catch (finalizeError) {
      try {
        await this._finalizeDelivery(persisted.message.id, {
          providerMessageId,
          state: OUTBOUND_DELIVERY_STATES.UNCERTAIN,
          error: finalizeError.message || 'finalize_failed',
        });
      } catch {
        // best effort: el mensaje queda pending si también falla el marcado uncertain
      }
      throw appError(
        'OUTBOUND_UNCERTAIN',
        'El envío quedó en estado incierto. No se reintenta automáticamente.',
        409,
        { messageId: persisted.message.id, providerMessageId },
      );
    }
  }

  async _finalizeDelivery(messageId, { providerMessageId, state, error = null }) {
    const current = await conversationMessageRepository.findById(messageId);
    if (!current) throw appError('NOT_FOUND', 'Mensaje no encontrado', 404);
    const metadata = outboundDeliveryMeta(current.metadataJson, {
      state,
      error: error || undefined,
      dispatching: false,
      dispatchWorkerId: undefined,
      dispatchLeaseUntil: undefined,
      confirmedAt: state === OUTBOUND_DELIVERY_STATES.CONFIRMED ? new Date().toISOString() : undefined,
    });
    await query(
      `UPDATE dbo.conversation_messages
       SET provider_message_id = COALESCE($2, provider_message_id),
           metadata_json = $3
       WHERE id = $1`,
      [messageId, providerMessageId, JSON.stringify(metadata)],
    );
    const linked = await conversationMessageRepository.findById(messageId);
    if (linked?.providerMessageId) {
      await twilioMessageDeliveryService.syncDeliveryAfterOutboundLink(linked);
    }
    return linked;
  }

  async _callTwilio(phoneNumber, { body, mediaUrl }) {
    try {
      twilioWhatsAppService.assertConfigured();
      const sent = await twilioWhatsAppService.sendWhatsAppMessage({ to: phoneNumber, body, mediaUrl });
      return sent.sid;
    } catch (error) {
      if (error.code === 'PUBLIC_URL_UNCONFIGURED' || error.code === 'OUTBOUND_MEDIA_URL_SECRET_MISSING') {
        throw appError(
          error.code,
          'No se pudo generar el enlace temporal para Twilio. Verificá APP_BASE_URL y SESSION_SECRET.',
          503,
        );
      }
      if (error.code === 'TWILIO_NOT_CONFIGURED') {
        throw appError(
          'TWILIO_NOT_CONFIGURED',
          'Twilio no está configurado. Verificá TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_WHATSAPP_FROM.',
          503,
        );
      }
      if (error.code === 'TWILIO_SEND_FAILED') {
        throw appError(
          'TWILIO_SEND_FAILED',
          'No se pudo enviar el mensaje por Twilio. Verificá la configuración o intentá nuevamente.',
          502,
        );
      }
      throw error;
    }
  }

  _shouldCallTwilio(conversation, isSeed) {
    return conversation.channel === 'whatsapp'
      && conversation.provider === 'twilio'
      && !isSeed
      && Boolean(conversation.phoneNumber);
  }

  async _acquireDispatchLease(messageId, workerId) {
    return tryAcquireOutboundDispatchLease(messageId, workerId);
  }

  async _isSeedConversation(conversationId) {
    const messages = await conversationMessageRepository.listByConversationId(
      conversationId,
      { limit: 1, offset: 0, order: 'asc' },
    );
    if (messages[0]?.metadataJson?.seed === true) return true;
    const conv = await conversationRepository.getConversationById(conversationId);
    return conv?.externalUserId?.startsWith('SIM-') ?? false;
  }
}

const agentOutboundSendService = new AgentOutboundSendService();
export default agentOutboundSendService;
export { expireStaleOutboundDispatchLeases, tryAcquireOutboundDispatchLease };