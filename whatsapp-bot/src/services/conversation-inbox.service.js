import { createReadStream } from 'node:fs';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import conversationSearchRepository from '../repositories/conversation-search.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import conversationService from './conversation.service.js';
import conversationBotLifecycleService from './conversation-bot-lifecycle.service.js';
import sessionService from './session.service.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import { withTransaction } from '../db/index.js';
import {
  mapConversationPublic,
  mapHumanHandoffPublic,
  mapLastMessagePublic,
  mapMessagePublic,
  mapSessionPublic,
} from '../utils/conversation-inbox.mapper.js';
import {
  absoluteStoragePath,
  resolveInboundMediaRoot,
  verifyInboundMediaObject,
} from '../utils/inbound-media-storage.js';
import { normalizeInboundMimeType } from '../utils/inbound-media-policy.js';
import {
  attachmentDownloadFilename,
  buildContentDispositionHeader,
} from '../utils/http-content-disposition.js';
import {
  notifyConversationAssigned,
  notifyConversationMessageCreated,
  notifyConversationReturnedToBot,
  notifyConversationUpdated,
} from '../realtime/conversation-live.notify.js';
import { validateContactName } from '../utils/contact-name.js';
import { agentsMatch, labelForAssignedAgent } from '../utils/agent-identity.js';
import { canTakeoverConversation } from '../auth/roles.js';
import { CONVERSATION_CHANNELS } from '../constants/conversation-channels.js';
import {
  RETURN_TO_BOT_BODY,
  RETURN_TO_BOT_EVENT,
} from '../utils/conversation-reentry-policy.js';
import conversationTakeoverService, {
  actorFromAdminUser,
  describeTakeoverAccess,
  isManualTakeoverEnabled,
} from './conversation-takeover.service.js';
import agentOutboundSendService from './agent-outbound-send.service.js';
import twilioMessageDeliveryService from './twilio-message-delivery.service.js';
import {
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
  ensureCorrelationId,
  logAttentionTransition,
  outcomeFromError,
} from './conversation-attention-transition-log.js';
import { isUuid } from '../utils/conversation-search.js';

function requireReturnActor(actor) {
  if (!actor?.agentId || !canTakeoverConversation(actor.role)) {
    throw appError(
      'FORBIDDEN',
      'No tenés permiso para devolver esta conversación al bot.',
      403,
    );
  }
  return actor;
}

function groupAttachmentsByMessageId(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const list = map.get(row.messageId) || [];
    list.push(row);
    map.set(row.messageId, list);
  }
  return map;
}

async function hydrateMessagesPublic(messages) {
  const attachmentMap = groupAttachmentsByMessageId(
    await attachmentRepository.findByMessageIds(messages.map((m) => m.id)),
  );
  const deliveryMap = await twilioMessageDeliveryService.buildDeliveryStatusMapForMessages(messages);
  return twilioMessageDeliveryService.mapMessagesPublicWithDelivery(
    messages,
    attachmentMap,
    deliveryMap,
  );
}

function parsePositiveInt(value, { fallback, min = 1, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function wantsTailLoad(query) {
  const tail = String(query.tail ?? query.mode ?? '').toLowerCase();
  return tail === '1' || tail === 'true' || tail === 'tail';
}

function optionalMessageId(value) {
  if (value == null || value === '') return null;
  const id = String(value).trim();
  if (!isUuid(id)) {
    throw appError('VALIDATION', 'Identificador de mensaje inválido', 400);
  }
  return id;
}

function parseConversationMessagesQuery(query = {}) {
  if (query.limit != null && query.limit !== '' && !Number.isInteger(Number(query.limit))) {
    throw appError('VALIDATION', 'limit debe ser un entero entre 1 y 500', 400);
  }
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  if (query.offset != null && query.offset !== '' && !Number.isInteger(Number(query.offset))) {
    throw appError('VALIDATION', 'offset debe ser un entero mayor o igual a 0', 400);
  }
  const offset = Math.max(Number(query.offset) || 0, 0);
  const order = String(query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const aroundMessageId = optionalMessageId(query.aroundMessageId);
  const beforeMessageId = optionalMessageId(query.beforeMessageId);
  const afterMessageId = optionalMessageId(query.afterMessageId);
  const tail = wantsTailLoad(query);

  const anchorCount = [aroundMessageId, beforeMessageId, afterMessageId].filter(Boolean).length;
  if (anchorCount > 1) {
    throw appError(
      'VALIDATION',
      'aroundMessageId, beforeMessageId y afterMessageId son mutuamente excluyentes',
      400,
    );
  }
  if (tail && anchorCount > 0) {
    throw appError('VALIDATION', 'tail no combina con anclas de mensaje', 400);
  }
  if (tail && (offset > 0 || order === 'desc')) {
    throw appError('VALIDATION', 'tail requiere offset 0 y order asc', 400);
  }
  if (anchorCount > 0 && offset > 0) {
    throw appError('VALIDATION', 'offset no aplica con anclas de mensaje', 400);
  }

  return {
    limit,
    offset,
    order,
    aroundMessageId,
    beforeMessageId,
    afterMessageId,
    tail,
  };
}

function humanAttentionReplyAllowed(locked, viewer) {
  if (!viewer?.agentId || !canTakeoverConversation(viewer.role)) return false;
  return locked?.status === 'assigned' || locked?.status === 'paused';
}

const ALLOWED_STATUS = new Set(['bot', 'waiting_human', 'assigned', 'closed', 'paused']);
const ALLOWED_CHANNEL = new Set(CONVERSATION_CHANNELS);
const ALLOWED_PROVIDER = new Set(['twilio', 'internal']);
const ALLOWED_SORT = new Set([
  'last_message_at_desc',
  'last_message_at_asc',
  'started_at_desc',
]);

const HUMAN_REPLY_STATUSES = new Set(['waiting_human', 'assigned', 'paused']);

function parseListFilters(query = {}) {
  const filters = {
    limit: query.limit,
    offset: query.offset,
    sort: ALLOWED_SORT.has(query.sort) ? query.sort : 'last_message_at_desc',
  };

  if (query.status && ALLOWED_STATUS.has(query.status)) {
    filters.status = query.status;
  }
  if (query.channel && ALLOWED_CHANNEL.has(query.channel)) {
    filters.channel = query.channel;
  }
  if (query.provider && ALLOWED_PROVIDER.has(query.provider)) {
    filters.provider = query.provider;
  }
  if (query.search && String(query.search).trim()) {
    filters.search = String(query.search).trim();
  }

  return filters;
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

function withAttention(row, actor) {
  const access = describeTakeoverAccess(row, actor);
  return {
    ...mapConversationPublic(row),
    ...access,
    assignedAgentLabel: labelForAssignedAgent(row?.assignedAgentId),
  };
}

export class ConversationInboxService {
  async ensureReady() {
    await ensureConversationDbReady();
  }

  async listInboxConversations(query = {}, actor = null) {
    await this.ensureReady();
    const filters = parseListFilters(query);
    const viewer = actor?.agentId ? actor : actorFromAdminUser(actor);

    const [items, total] = await Promise.all([
      conversationRepository.listConversations(filters),
      conversationRepository.countConversations(filters),
    ]);

    const ids = items.map((c) => c.id);
    const [lastMessages, handoffs] = await Promise.all([
      conversationMessageRepository.getLastMessageByConversationIds(ids),
      humanHandoffRepository.listLatestByConversationIds(ids),
    ]);

    const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
    const offset = Math.max(Number(filters.offset) || 0, 0);

    return {
      items: items.map((row) => {
        const lastMsg = lastMessages.get(row.id);
        const handoff = handoffs.get(row.id);
        return {
          ...withAttention(row, viewer),
          lastMessage: mapLastMessagePublic(lastMsg),
          humanHandoff: mapHumanHandoffPublic(handoff),
        };
      }),
      total,
      limit,
      offset,
    };
  }

  async getConversationDetail(conversationId, actor = null) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }
    const viewer = actor?.agentId ? actor : actorFromAdminUser(actor);

    const [activeSession, humanHandoff] = await Promise.all([
      conversationSessionRepository.findLatestOpenByConversationId(conversationId),
      humanHandoffRepository.findLatestByConversationId(conversationId),
    ]);

    return {
      conversation: withAttention(conversation, viewer),
      activeSession: mapSessionPublic(activeSession),
      humanHandoff: mapHumanHandoffPublic(humanHandoff),
    };
  }

  async getConversationMessages(conversationId, query = {}) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const {
      limit,
      offset,
      order,
      aroundMessageId,
      beforeMessageId,
      afterMessageId,
      tail,
    } = parseConversationMessagesQuery(query);

    if (aroundMessageId) {
      const before = parsePositiveInt(query.before, { fallback: 40, min: 0, max: 100 });
      const after = parsePositiveInt(query.after, { fallback: 40, min: 0, max: 100 });
      const window = await conversationSearchRepository.listAroundMessage(
        conversationId,
        aroundMessageId,
        { before, after },
      );
      if (!window) {
        throw appError('NOT_FOUND', 'Mensaje no encontrado en esta conversación', 404);
      }
      const items = await hydrateMessagesPublic(window.items);
      return {
        items,
        focusMessageId: window.focusMessageId,
        hasMoreBefore: window.hasMoreBefore,
        hasMoreAfter: window.hasMoreAfter,
        mode: 'around',
        limit: before + after + 1,
      };
    }

    if (beforeMessageId) {
      const pageLimit = parsePositiveInt(query.limit, { fallback: 50, min: 1, max: 100 });
      const page = await conversationSearchRepository.listBeforeMessage(
        conversationId,
        beforeMessageId,
        pageLimit,
      );
      if (!page) {
        throw appError('NOT_FOUND', 'Mensaje no encontrado en esta conversación', 404);
      }
      const items = await hydrateMessagesPublic(page.items);
      return {
        items,
        hasMoreBefore: page.hasMoreBefore,
        mode: 'before',
        anchorMessageId: beforeMessageId,
        limit: pageLimit,
      };
    }

    if (afterMessageId) {
      const pageLimit = parsePositiveInt(query.limit, { fallback: 50, min: 1, max: 100 });
      const page = await conversationSearchRepository.listAfterMessage(
        conversationId,
        afterMessageId,
        pageLimit,
      );
      if (!page) {
        throw appError('NOT_FOUND', 'Mensaje no encontrado en esta conversación', 404);
      }
      const items = await hydrateMessagesPublic(page.items);
      return {
        items,
        hasMoreAfter: page.hasMoreAfter,
        mode: 'after',
        anchorMessageId: afterMessageId,
        limit: pageLimit,
      };
    }

    if (tail) {
      const tailLimit = Math.min(limit, 500);
      const { items: messages, hasMoreBefore } = await conversationMessageRepository.listLatestTail(
        conversationId,
        tailLimit,
      );
      const items = await hydrateMessagesPublic(messages);
      return {
        items,
        hasMoreBefore,
        limit: tailLimit,
        offset: 0,
        order: 'asc',
        mode: 'tail',
      };
    }

    const [messages, total] = await Promise.all([
      conversationMessageRepository.listByConversationId(conversationId, { limit, offset, order }),
      conversationMessageRepository.countByConversationId(conversationId),
    ]);

    return {
      items: await hydrateMessagesPublic(messages),
      total,
      limit,
      offset,
      order,
    };
  }

  async openMessageAttachmentContent(conversationId, messageId, attachmentId, { download = false } = {}) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const attachment = await attachmentRepository.findById(attachmentId);
    if (
      !attachment
      || attachment.conversationId !== conversationId
      || attachment.messageId !== messageId
    ) {
      throw appError('NOT_FOUND', 'Adjunto no encontrado', 404);
    }

    if (attachment.status !== 'stored' || !attachment.storageKey) {
      throw appError('ATTACHMENT_NOT_AVAILABLE', 'El adjunto no está disponible', 404);
    }

    const rootDir = resolveInboundMediaRoot();
    let readable = false;
    try {
      readable = await verifyInboundMediaObject(rootDir, attachment.storageKey);
    } catch {
      readable = false;
    }
    if (!readable) {
      throw appError('NOT_FOUND', 'Archivo no encontrado', 404);
    }

    const mimeType = normalizeInboundMimeType(attachment.mimeType) || 'application/octet-stream';
    const isImage = mimeType === 'image/jpeg' || mimeType === 'image/png';
    const disposition = download || !isImage ? 'attachment' : 'inline';

    return {
      absolutePath: absoluteStoragePath(rootDir, attachment.storageKey),
      mimeType,
      disposition,
      filename: attachmentDownloadFilename(attachment),
      byteSize: attachment.byteSize,
    };
  }

  async streamMessageAttachmentContent(conversationId, messageId, attachmentId, res, { download = false } = {}) {
    const file = await this.openMessageAttachmentContent(
      conversationId,
      messageId,
      attachmentId,
      { download },
    );

    if (res.destroyed || res.writableEnded) {
      const err = new Error('Cliente desconectado');
      err.code = 'CLIENT_CLOSED';
      err.httpStatus = 499;
      throw err;
    }

    let completed = false;
    let fileStream = null;

    const cleanup = () => {
      if (fileStream && !fileStream.destroyed) fileStream.destroy();
    };

    return new Promise((resolve, reject) => {
      const fail = (error) => {
        if (completed) return;
        completed = true;
        cleanup();
        if (!res.headersSent) reject(error);
        else {
          res.destroy();
          resolve();
        }
      };

      res.on('close', () => {
        if (!completed) cleanup();
      });

      try {
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader(
          'Content-Disposition',
          buildContentDispositionHeader(file.disposition, file.filename),
        );
        if (file.byteSize != null && file.byteSize >= 0) {
          res.setHeader('Content-Length', String(file.byteSize));
        }
      } catch (error) {
        fail(error);
        return;
      }

      fileStream = createReadStream(file.absolutePath);
      fileStream.on('error', () => {
        fail(appError('NOT_FOUND', 'Archivo no encontrado', 404));
      });
      fileStream.on('end', () => {
        completed = true;
        resolve();
      });
      fileStream.pipe(res);
    });
  }

  async claimConversation(conversationId, agentId, actor = null) {
    await this.ensureReady();
    if (isManualTakeoverEnabled()) {
      const viewer = actorFromAdminUser(actor);
      if (!viewer) {
        throw appError('FORBIDDEN', 'No tenés permiso para tomar conversaciones.', 403);
      }
      return conversationTakeoverService.takeover({
        conversationId,
        actor: viewer,
      });
    }
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }
    if (conversation.status === 'closed') {
      throw appError(
        'CONVERSATION_CLOSED',
        'No se puede tomar una conversación cerrada',
        409,
      );
    }
    if (conversation.status === 'bot') {
      throw appError(
        'CONVERSATION_BOT_ACTIVE',
        'El bot está activo en esta conversación. No se puede tomar sin derivación humana.',
        409,
      );
    }
    if (conversation.status === 'assigned' || conversation.status === 'paused') {
      return { conversation: mapConversationPublic(conversation) };
    }
    if (conversation.status !== 'waiting_human') {
      throw appError(
        'INVALID_STATE',
        'Solo se pueden tomar conversaciones en espera de humano',
        409,
      );
    }

    const correlationId = ensureCorrelationId();
    const updated = await this._assignConversationToAgent(conversationId, agentId, conversation, correlationId);
    return { conversation: mapConversationPublic(updated) };
  }

  async _assignConversationToAgent(conversationId, agentId, snapshotBefore = null, correlationId = null) {
    const startedAt = Date.now();
    const previousStatus = snapshotBefore?.status ?? null;
    const correlation = ensureCorrelationId(correlationId);
    try {
      const updated = await conversationService.markAssigned(conversationId, agentId);
      let handoff = await humanHandoffRepository.findPendingByConversationId(conversationId);
      if (handoff) {
        await humanHandoffRepository.updateHandoff(handoff.id, {
          status: 'assigned',
          assignedAgentId: agentId,
          assignedAt: new Date(),
        });
      } else {
        handoff = await humanHandoffRepository.findLatestByConversationId(conversationId);
        if (handoff && ['pending', 'assigned'].includes(handoff.status)) {
          await humanHandoffRepository.updateHandoff(handoff.id, {
            status: 'assigned',
            assignedAgentId: agentId,
            assignedAt: new Date(),
          });
        }
      }

      notifyConversationAssigned(updated, handoff);
      const alreadyAssignedToSameAgent = snapshotBefore?.status === 'assigned'
        && agentsMatch(snapshotBefore?.assignedAgentId, agentId)
        && updated?.status === 'assigned';
      const transitionApplied = !alreadyAssignedToSameAgent
        && previousStatus === 'waiting_human'
        && updated?.status === 'assigned';
      logAttentionTransition({
        transitionType: TRANSITION_TYPES.legacyAssign,
        outcome: transitionApplied ? OUTCOMES.confirmed : OUTCOMES.idempotentReplay,
        conversationId,
        handoffId: handoff?.id ?? null,
        correlationId: correlation,
        previousStatus,
        newStatus: updated?.status ?? 'assigned',
        reasonCode: REASON_CODES.waitingHumanClaim,
        actorKind: 'operator',
        actorAgentId: agentId,
        statusVersion: updated?.statusVersion ?? null,
        durationMs: Date.now() - startedAt,
      });
      return updated;
    } catch (error) {
      const { outcome, errorCode } = outcomeFromError(error);
      logAttentionTransition({
        transitionType: TRANSITION_TYPES.legacyAssign,
        outcome,
        conversationId,
        correlationId: correlation,
        previousStatus,
        newStatus: previousStatus,
        reasonCode: REASON_CODES.waitingHumanClaim,
        actorKind: 'operator',
        actorAgentId: agentId,
        errorCode,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  async sendAgentMessage(conversationId, body, agentId, actor = null, options = {}) {
    const ctx = await this._buildAgentOutboundContext(conversationId, agentId, actor);
    if (Array.isArray(options.attachments) && options.attachments.length > 0) {
      return agentOutboundSendService.sendBatch(ctx, {
        body,
        attachments: options.attachments,
        batchClientRequestId: options.batchClientRequestId || options.clientRequestId || null,
      });
    }

    const hasAttachment = Boolean(
      options.attachment?.contentBase64
      || options.attachment?.buffer
      || options.attachment?.mimeType,
    );
    if (hasAttachment) {
      const result = await agentOutboundSendService.sendSingleItem(ctx, {
        body,
        attachment: options.attachment,
        clientRequestId: options.clientRequestId || options.attachment?.clientRequestId,
        includeBody: true,
      });
      if (!result.ok) {
        throw appError(
          result.error?.code || 'TWILIO_SEND_FAILED',
          result.error?.message || 'No se pudo enviar el archivo.',
          502,
          { deliveryState: result.deliveryState, message: result.message },
        );
      }
      return {
        message: result.message,
        conversation: result.conversation,
        idempotent: result.idempotent,
      };
    }

    return agentOutboundSendService.sendTextOnly(ctx, {
      body,
      clientRequestId: options.clientRequestId,
    });
  }

  async _buildAgentOutboundContext(conversationId, agentId, actor) {
    if (isManualTakeoverEnabled()) {
      return this._buildOwnedAgentOutboundContext(conversationId, actor);
    }
    return this._buildSharedAgentOutboundContext(conversationId, agentId);
  }

  async _buildOwnedAgentOutboundContext(conversationId, actor) {
    await this.ensureReady();
    const viewer = actorFromAdminUser(actor);
    if (!viewer) {
      throw appError('FORBIDDEN', 'No tenés permiso para responder esta conversación.', 403);
    }

    let conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    if (conversation.status === 'closed') {
      throw appError('CONVERSATION_CLOSED', 'No se puede responder una conversación cerrada', 409);
    }
    if (conversation.status === 'bot') {
      throw appError(
        'CONVERSATION_BOT_ACTIVE',
        'Para responder, primero tomá la conversación o derivá al equipo humano',
        409,
      );
    }
    if (conversation.status === 'waiting_human') {
      await conversationTakeoverService.takeover({ conversationId, actor: viewer });
      conversation = await conversationRepository.getConversationById(conversationId);
    }

    const authorized = await withTransaction(async (transaction) => {
      const locked = await conversationRepository.findByIdForUpdate(conversationId, { transaction });
      if (!locked) throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
      if (!humanAttentionReplyAllowed(locked, viewer)) {
        throw appError(
          'CONVERSATION_OWNED',
          'La conversación ya está asignada a otro agente.',
          409,
          { assignedAgentId: locked.assignedAgentId },
        );
      }
      return locked;
    });

    return {
      conversation: authorized,
      actorAgentId: viewer.agentId,
      viewer,
      touchConversationInTransaction: async (id, ctx, { transaction } = {}) => {
        const locked = await conversationRepository.findByIdForUpdate(id, { transaction });
        const stillReplyable = Boolean(locked) && humanAttentionReplyAllowed(locked, ctx.viewer);
        return conversationRepository.updateConversation(
          id,
          stillReplyable
            ? { status: 'assigned', assignedAgentId: locked.assignedAgentId, lastMessageAt: new Date() }
            : { lastMessageAt: new Date() },
          { transaction },
        ) || locked;
      },
      touchConversationAfterSend: async (id, ctx) => {
        const current = await conversationRepository.getConversationById(id);
        const stillReplyable = Boolean(current) && humanAttentionReplyAllowed(current, ctx.viewer);
        return conversationRepository.updateConversation(
          id,
          stillReplyable
            ? { status: 'assigned', assignedAgentId: current.assignedAgentId, lastMessageAt: new Date() }
            : { lastMessageAt: new Date() },
        ) || current;
      },
    };
  }

  async _buildSharedAgentOutboundContext(conversationId, agentId) {
    await this.ensureReady();
    let conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }
    if (conversation.status === 'closed') {
      throw appError(
        'CONVERSATION_CLOSED',
        'No se puede responder una conversación cerrada',
        409,
      );
    }
    if (conversation.status === 'bot') {
      throw appError(
        'CONVERSATION_BOT_ACTIVE',
        'Para responder, primero tomá la conversación o derivá al equipo humano',
        409,
      );
    }

    if (conversation.status === 'waiting_human') {
      const claimed = await this.claimConversation(conversationId, agentId, null);
      conversation = await conversationRepository.getConversationById(claimed.conversation.id);
    }

    if (!HUMAN_REPLY_STATUSES.has(conversation.status)) {
      throw appError('INVALID_STATE', 'Estado de conversación no compatible con respuesta manual', 409);
    }

    const patchAssigned = {
      status: 'assigned',
      assignedAgentId: agentId,
      lastMessageAt: new Date(),
    };

    return {
      conversation,
      actorAgentId: agentId,
      touchConversationInTransaction: async (id, _ctx, { transaction } = {}) =>
        conversationRepository.updateConversation(id, patchAssigned, { transaction }) || conversation,
      touchConversationAfterSend: async (id) =>
        conversationRepository.updateConversation(id, patchAssigned) || conversation,
    };
  }

  async _returnConversationToBot(conversationId, {
    resolutionNote = null,
    systemMessage = RETURN_TO_BOT_BODY,
    generatedBy = 'agent_inbox',
    actor = null,
  } = {}) {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const correlationId = ensureCorrelationId();
    const reasonCode = generatedBy === 'agent_inbox_close'
      ? REASON_CODES.inboxClose
      : REASON_CODES.inboxReturn;
    const { conversation: updated } = await conversationBotLifecycleService.returnConversationToBot(
      conversation,
      {
        resolutionNote,
        actor,
        takeoverEnabled: isManualTakeoverEnabled(),
        correlationId,
        reasonCode,
      },
    );

    await conversationMessageRepository.createMessage({
      conversationId,
      direction: 'outbound',
      senderType: 'system',
      body: systemMessage,
      provider: conversation.provider,
      metadataJson: { event: RETURN_TO_BOT_EVENT, generatedBy },
    });

    const result = { conversation: mapConversationPublic(updated) };
    notifyConversationReturnedToBot(updated);
    return result;
  }

  async closeConversation(conversationId, resolutionNote = null, actor = null) {
    await this.ensureReady();
    requireReturnActor(actor);
    return this._returnConversationToBot(conversationId, {
      resolutionNote,
      generatedBy: 'agent_inbox_close',
      actor,
    });
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

  async updateConversationContact(conversationId, rawName) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const displayName = rawName === null || rawName === undefined
      ? null
      : validateContactName(rawName);

    const updated = await conversationRepository.updateConversation(conversationId, {
      displayName,
    });

    if (displayName && conversation.phoneNumber) {
      await conversationRepository.syncDisplayNameByPhoneAndChannel(
        conversation.phoneNumber,
        conversation.channel,
        displayName,
      );
    }

    notifyConversationUpdated(updated);

    return {
      conversationId: updated.id,
      phone: updated.phoneNumber ?? null,
      contactName: updated.displayName ?? null,
      displayName: updated.displayName ?? null,
      conversation: mapConversationPublic(updated),
    };
  }

  async returnConversationToBot(conversationId, actor = null) {
    await this.ensureReady();
    requireReturnActor(actor);
    return this._returnConversationToBot(conversationId, {
      systemMessage: 'Conversación devuelta al bot.',
      generatedBy: 'agent_inbox_return_to_bot',
      actor,
    });
  }
}

const conversationInboxService = new ConversationInboxService();
export default conversationInboxService;
export { parseListFilters };
