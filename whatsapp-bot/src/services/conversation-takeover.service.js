import crypto from 'crypto';
import { query, withTransaction } from '../db/index.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from './session.service.js';
import { notifyConversationAssigned } from '../realtime/conversation-live.notify.js';
import {
  mapConversationPublic,
  mapHumanHandoffPublic,
} from '../utils/conversation-inbox.mapper.js';
import { agentsMatch, resolveEnabledPanelAgent } from '../utils/agent-identity.js';
import {
  canReassignConversation,
  canTakeoverConversation,
} from '../auth/roles.js';
import { isManualTakeoverEnabled } from '../utils/manual-takeover-flag.js';

export { isManualTakeoverEnabled } from '../utils/manual-takeover-flag.js';
export const MANUAL_TAKEOVER_EVENT = 'manual_takeover';
export const MANUAL_REASSIGN_EVENT = 'manual_reassign';

function appError(code, message, httpStatus = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.apiError = code;
  err.apiMessage = message;
  if (details) err.details = details;
  return err;
}

function reentryStatusOf(conversation) {
  const status = conversation?.reentryJson?.status;
  return status == null || status === '' ? null : String(status);
}

function exclusiveOwner(conversation) {
  return Boolean(conversation?.assignedAgentId)
    && (conversation.status === 'assigned' || conversation.status === 'paused');
}

const RETURNABLE_STATUSES = new Set(['waiting_human', 'assigned', 'paused']);

/**
 * El botón no es la autorización. El cierre vuelve a evaluarla bajo lock.
 * Con la toma apagada, cualquier operador habilitado puede devolver la cola.
 */
export function describeReturnAccess(conversation, actor, { enabled = isManualTakeoverEnabled() } = {}) {
  const permitted = canTakeoverConversation(actor?.role);
  const returnable = RETURNABLE_STATUSES.has(conversation?.status);
  if (!permitted || !returnable) {
    return { canReturnToBot: false, canForceReturn: false };
  }
  if (!enabled || !exclusiveOwner(conversation) || agentsMatch(conversation.assignedAgentId, actor?.agentId)) {
    return { canReturnToBot: true, canForceReturn: false };
  }
  return { canReturnToBot: false, canForceReturn: false };
}

function clearPendingReentry(conversation) {
  const status = reentryStatusOf(conversation);
  return status === 'pending' || status === 'awaiting_choice';
}

/**
 * Flags que el inbox muestra. La autorización real vuelve a evaluarse en la toma.
 */
export function describeTakeoverAccess(conversation, actor, { enabled = isManualTakeoverEnabled() } = {}) {
  const permitted = canTakeoverConversation(actor?.role);
  const botPaused = conversation?.status === 'assigned' || conversation?.status === 'paused';
  const returnAccess = describeReturnAccess(conversation, actor, { enabled });
  const base = {
    canTakeover: false,
    takeoverBlock: null,
    reentryStatus: reentryStatusOf(conversation),
    botPaused,
    statusVersion: conversation?.statusVersion ?? null,
    ...returnAccess,
    canReassign: Boolean(
      canReassignConversation(actor?.role)
      && botPaused
      && conversation?.assignedAgentId
      && !agentsMatch(conversation.assignedAgentId, actor?.agentId),
    ),
  };

  if (!enabled) return { ...base, takeoverBlock: 'disabled' };
  if (!permitted) return { ...base, takeoverBlock: 'forbidden' };
  if (!conversation) return { ...base, takeoverBlock: 'not_found' };
  if (conversation.status === 'closed') return { ...base, takeoverBlock: 'closed' };

  const hasOwner = Boolean(conversation.assignedAgentId)
    && (conversation.status === 'assigned' || conversation.status === 'paused');
  if (hasOwner && agentsMatch(conversation.assignedAgentId, actor?.agentId)) {
    return { ...base, takeoverBlock: 'already_owner' };
  }
  if (hasOwner) return { ...base, takeoverBlock: 'owned_by_other' };

  if (
    conversation.status === 'bot'
    || conversation.status === 'waiting_human'
    || conversation.status === 'paused'
  ) {
    return { ...base, canTakeover: true, takeoverBlock: null };
  }

  return { ...base, takeoverBlock: 'invalid_state' };
}

export function actorFromAdminUser(adminUser) {
  if (!adminUser?.username) return null;
  return resolveEnabledPanelAgent(adminUser.username);
}

function attentionSnapshot(conversation) {
  return {
    status: conversation?.status ?? null,
    assignedAgentId: conversation?.assignedAgentId ?? null,
    statusVersion: conversation?.statusVersion ?? null,
    currentNodeKey: conversation?.currentNodeKey ?? null,
    reentryStatus: reentryStatusOf(conversation),
  };
}

/**
 * Toma manual y reasignación. La reasignación no reutiliza la toma para no pisar un dueño.
 */
export class ConversationTakeoverService {
  constructor(deps = {}) {
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
    this.messageRepo = deps.messageRepo || conversationMessageRepository;
    this.handoffRepo = deps.handoffRepo || humanHandoffRepository;
    this.runtimeSession = deps.runtimeSession || sessionService;
    this.runTransaction = deps.runTransaction || withTransaction;
    this.notifyAssigned = deps.notifyAssigned || notifyConversationAssigned;
    this.recordAudit = deps.recordAudit || insertAuditLog;
    this.findOperationRequest = deps.findOperationRequest || findOperationRequestSql;
    this.saveOperationRequest = deps.saveOperationRequest || insertOperationRequestSql;
    this.resolveTargetAgent = deps.resolveTargetAgent || resolveEnabledPanelAgent;
    this.assertSchema = deps.assertSchema || (async () => {
      if (typeof this.conversationRepo.assertTakeoverSchema === 'function') {
        await this.conversationRepo.assertTakeoverSchema();
      }
    });
    this.enabled = deps.enabled || isManualTakeoverEnabled;
  }

  async takeover(input) {
    const actor = input?.actor || {};
    if (!canTakeoverConversation(actor.role)) {
      throw appError('FORBIDDEN', 'No tenés permiso para tomar conversaciones.', 403);
    }
    if (!this.enabled()) {
      throw appError(
        'TAKEOVER_DISABLED',
        'La toma manual está desactivada.',
        409,
      );
    }
    await this.assertSchema();

    const conversationId = input.conversationId;
    const clientRequestId = normalizeRequestId(input.clientRequestId);
    const requestHash = clientRequestId
      ? hashOperation('takeover', actor, {
        reason: input.reason || null,
        expectedVersion: input.expectedVersion ?? null,
      })
      : null;
    let committed = null;

    const txResult = await this.runTransaction(async (transaction) => {
      const locked = await this.conversationRepo.findByIdForUpdate(conversationId, { transaction });
      if (!locked) throw appError('NOT_FOUND', 'Conversación no encontrada', 404);

      if (clientRequestId) {
        const replay = await this._replayRequest({
          transaction,
          conversationId,
          operation: 'takeover',
          clientRequestId,
          actor,
          requestHash,
          locked,
          stillOwns: (row) => Boolean(row.assignedAgentId)
            && (row.status === 'assigned' || row.status === 'paused')
            && agentsMatch(row.assignedAgentId, actor.agentId),
        });
        if (replay) return replay;
      }

      if (locked.status === 'closed') {
        throw appError('CONVERSATION_CLOSED', 'No se puede tomar una conversación cerrada', 409);
      }

      if (input.expectedVersion != null && input.expectedVersion !== '') {
        const expected = Number(input.expectedVersion);
        const current = locked.statusVersion;
        if (current == null || !Number.isInteger(expected) || expected !== current) {
          throw appError(
            'STATUS_VERSION_CONFLICT',
            'La conversación cambió. Actualizá el inbox e intentá de nuevo.',
            409,
            { statusVersion: current ?? null },
          );
        }
      }

      const owned = Boolean(locked.assignedAgentId)
        && (locked.status === 'assigned' || locked.status === 'paused');
      if (owned && agentsMatch(locked.assignedAgentId, actor.agentId)) {
        if (clientRequestId) {
          await this._saveRequest({
            conversationId,
            operation: 'takeover',
            clientRequestId,
            actorAgentId: actor.agentId,
            requestHash,
          }, transaction);
        }
        const handoff = await this._latestActiveHandoff(conversationId, transaction);
        return { kind: 'idempotent', conversation: locked, handoff };
      }
      if (owned) {
        throw appError(
          'CONVERSATION_OWNED',
          'La conversación ya está asignada a otro agente.',
          409,
          { assignedAgentId: locked.assignedAgentId },
        );
      }

      if (!['bot', 'waiting_human', 'paused', 'assigned'].includes(locked.status)) {
        throw appError('INVALID_STATE', 'Estado de conversación no compatible con la toma', 409);
      }

      const previous = attentionSnapshot(locked);
      const now = new Date();
      const handoff = await this._assignActiveHandoff(locked, actor, now, transaction);
      await this.sessionRepo.pauseAllOpenForConversation(conversationId, { transaction });

      const patch = {
        status: 'assigned',
        assignedAgentId: actor.agentId,
        incrementStatusVersion: true,
      };
      if (clearPendingReentry(locked)) patch.reentryJson = null;

      const updated = await this.conversationRepo.updateConversation(
        conversationId,
        patch,
        { transaction },
      );
      const stored = updated || { ...locked, ...patch, reentryJson: patch.reentryJson ?? locked.reentryJson };

      await this.messageRepo.createMessage({
        conversationId,
        direction: 'outbound',
        senderType: 'system',
        body: `${actor.username || 'Un agente'} tomó la conversación. El bot quedó pausado.`,
        provider: locked.provider || 'internal',
        metadataJson: {
          event: MANUAL_TAKEOVER_EVENT,
          generatedBy: 'agent_inbox',
          agentId: actor.agentId,
          agentLabel: actor.username || null,
          clientRequestId,
        },
      }, { transaction });

      await this.recordAudit({
        actorUserId: actor.agentId,
        entityType: 'conversation',
        entityId: conversationId,
        action: MANUAL_TAKEOVER_EVENT,
        beforeJson: previous,
        afterJson: attentionSnapshot(stored),
        metadata: {
          origin: MANUAL_TAKEOVER_EVENT,
          reason: input.reason || null,
          clientRequestId,
          correlationId: clientRequestId || crypto.randomUUID(),
          actorUsername: actor.username || null,
          previousNodeKey: previous.currentNodeKey,
        },
      }, { transaction });

      if (clientRequestId) {
        await this._saveRequest({
          conversationId,
          operation: 'takeover',
          clientRequestId,
          actorAgentId: actor.agentId,
          requestHash,
        }, transaction);
      }

      return { kind: 'taken', conversation: stored, handoff, previous };
    });

    committed = txResult.conversation;
    if (txResult.kind === 'taken') {
      await this._resetRuntime(committed);
    }
    this._notify(committed, txResult.handoff);

    return this._publicResult(committed, txResult.handoff, actor, {
      idempotent: txResult.kind !== 'taken',
    });
  }

  /**
   * Cambia el dueño sin devolver la conversación al bot y sin usar la toma.
   */
  async reassign(input) {
    const actor = input?.actor || {};
    if (!canReassignConversation(actor.role)) {
      throw appError('FORBIDDEN', 'No tenés permiso para reasignar conversaciones.', 403);
    }
    if (!this.enabled()) {
      throw appError('TAKEOVER_DISABLED', 'La toma manual está desactivada.', 409);
    }
    await this.assertSchema();

    const reason = String(input?.reason || '').trim();
    if (!reason) {
      throw appError('REASON_REQUIRED', 'La reasignación requiere un motivo.', 400);
    }
    const targetUsername = String(input?.targetUsername || '').trim();
    if (!targetUsername) {
      throw appError('TARGET_REQUIRED', 'Indicá el agente destino.', 400);
    }
    const target = this.resolveTargetAgent(targetUsername);
    if (!target?.enabled || !target.agentId) {
      throw appError(
        'TARGET_AGENT_NOT_FOUND',
        'El agente destino no existe o no está habilitado.',
        404,
      );
    }
    const targetAgentId = target.agentId;
    const conversationId = input.conversationId;

    const txResult = await this.runTransaction(async (transaction) => {
      const locked = await this.conversationRepo.findByIdForUpdate(conversationId, { transaction });
      if (!locked) throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
      if (locked.status === 'closed') {
        throw appError('CONVERSATION_CLOSED', 'No se puede reasignar una conversación cerrada', 409);
      }
      if (locked.status !== 'assigned' && locked.status !== 'paused') {
        throw appError(
          'CONVERSATION_NOT_ASSIGNED',
          'Solo se reasigna una conversación que ya tiene un agente. Para tomarla usá la toma manual.',
          409,
        );
      }
      if (!locked.assignedAgentId) {
        throw appError(
          'CONVERSATION_NOT_ASSIGNED',
          'La conversación no tiene un agente asignado.',
          409,
        );
      }
      if (agentsMatch(locked.assignedAgentId, targetAgentId)) {
        const handoff = await this._latestActiveHandoff(conversationId, transaction);
        return { kind: 'idempotent', conversation: locked, handoff };
      }

      const previous = attentionSnapshot(locked);
      const now = new Date();
      const handoff = await this._assignActiveHandoff(
        locked,
        { agentId: targetAgentId, username: targetUsername },
        now,
        transaction,
        { reassign: true },
      );
      const updated = await this.conversationRepo.updateConversation(
        conversationId,
        {
          status: 'assigned',
          assignedAgentId: targetAgentId,
          incrementStatusVersion: true,
        },
        { transaction },
      );
      const stored = updated || { ...locked, status: 'assigned', assignedAgentId: targetAgentId };

      await this.messageRepo.createMessage({
        conversationId,
        direction: 'outbound',
        senderType: 'system',
        body: `${actor.username || 'Un supervisor'} reasignó la conversación a ${targetUsername}. El bot sigue pausado.`,
        provider: locked.provider || 'internal',
        metadataJson: {
          event: MANUAL_REASSIGN_EVENT,
          generatedBy: 'agent_inbox',
          agentId: targetAgentId,
          agentLabel: targetUsername,
          actorLabel: actor.username || null,
        },
      }, { transaction });

      await this.recordAudit({
        actorUserId: actor.agentId,
        entityType: 'conversation',
        entityId: conversationId,
        action: MANUAL_REASSIGN_EVENT,
        beforeJson: previous,
        afterJson: attentionSnapshot(stored),
        metadata: {
          origin: MANUAL_REASSIGN_EVENT,
          reason,
          actorUsername: actor.username || null,
          targetUsername,
          targetAgentId,
        },
      }, { transaction });

      return { kind: 'reassigned', conversation: stored, handoff };
    });

    this._notify(txResult.conversation, txResult.handoff);
    return this._publicResult(txResult.conversation, txResult.handoff, actor, {
      idempotent: txResult.kind === 'idempotent',
      assignedAgentLabel: targetUsername,
    });
  }

  async _replayRequest({
    transaction,
    conversationId,
    operation,
    clientRequestId,
    actor,
    requestHash,
    locked,
    stillOwns,
  }) {
    const existing = await this.findOperationRequest(
      conversationId,
      operation,
      clientRequestId,
      { transaction },
    );
    if (!existing) return null;
    const sameActor = agentsMatch(existing.actorAgentId || existing.actor_agent_id, actor.agentId);
    const sameHash = (existing.requestHash || existing.request_hash) === requestHash;
    if (!sameActor || !sameHash) {
      throw appError(
        'IDEMPOTENCY_CONFLICT',
        'Ese identificador de solicitud ya fue usado con otro actor o con otros datos.',
        409,
      );
    }
    if (stillOwns(locked)) {
      const handoff = await this._latestActiveHandoff(conversationId, transaction);
      return { kind: 'replay', conversation: locked, handoff };
    }
    throw appError(
      'IDEMPOTENCY_STALE',
      'La solicitud ya se confirmó y la conversación ya no está en ese estado. No se vuelve a aplicar.',
      409,
    );
  }

  async _saveRequest(entry, transaction) {
    try {
      await this.saveOperationRequest(entry, { transaction });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw appError(
        'IDEMPOTENCY_CONFLICT',
        'Ese identificador de solicitud ya fue usado.',
        409,
      );
    }
  }

  async _latestActiveHandoff(conversationId, transaction) {
    const active = await this.handoffRepo.findActiveByConversationIdForUpdate(
      conversationId,
      { transaction },
    );
    return active[0] || null;
  }

  async _assignActiveHandoff(locked, actor, now, transaction, { reassign = false } = {}) {
    const active = await this.handoffRepo.findActiveByConversationIdForUpdate(
      locked.id,
      { transaction },
    );
    if (active.length > 0) {
      const ranked = [...active].sort((left, right) => {
        const leftAt = new Date(left.requestedAt || 0).getTime();
        const rightAt = new Date(right.requestedAt || 0).getTime();
        return rightAt - leftAt;
      });
      const [primary, ...extras] = ranked;
      for (const extra of extras) {
        await this.handoffRepo.updateHandoff(extra.id, {
          status: 'resolved',
          resolvedAt: now,
          resolutionNote: 'superseded_by_manual_takeover',
        }, { transaction });
      }
      return this.handoffRepo.updateHandoff(primary.id, {
        status: 'assigned',
        assignedAgentId: actor.agentId,
        assignedAt: now,
      }, { transaction });
    }
    if (reassign) {
      throw appError(
        'HANDOFF_NOT_ACTIVE',
        'No hay una atención humana activa para reasignar.',
        409,
      );
    }
    const created = await this.handoffRepo.createHandoff({
      conversationId: locked.id,
      requestedBy: 'agent',
      reason: 'manual_takeover',
      status: 'assigned',
      assignedAgentId: actor.agentId,
    }, { transaction });
    return this.handoffRepo.updateHandoff(created.id, { assignedAt: now }, { transaction });
  }

  async _resetRuntime(conversation) {
    if (!conversation?.externalUserId || typeof this.runtimeSession.resetSession !== 'function') return;
    try {
      await this.runtimeSession.resetSession(conversation.externalUserId);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'manual_takeover_runtime_reset_failed',
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  _notify(conversation, handoff) {
    try {
      this.notifyAssigned(conversation, handoff || null);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'manual_takeover_notify_failed',
        conversationId: conversation?.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  _publicResult(conversation, handoff, actor, { idempotent, assignedAgentLabel = null }) {
    const access = describeTakeoverAccess(conversation, {
      role: actor.role,
      agentId: actor.agentId,
      username: actor.username,
    }, { enabled: this.enabled() });
    const label = assignedAgentLabel || actor.username || null;
    return {
      idempotent,
      assignedAgentLabel: label,
      humanHandoff: mapHumanHandoffPublic(handoff),
      conversation: {
        ...mapConversationPublic(conversation),
        ...access,
        assignedAgentLabel: label,
      },
    };
  }
}

function normalizeRequestId(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.length > 80) return null;
  return trimmed;
}

function hashOperation(operation, actor, params) {
  return crypto.createHash('sha256').update(JSON.stringify({
    operation,
    actorId: String(actor?.agentId || ''),
    reason: params.reason || null,
    expectedVersion: params.expectedVersion ?? null,
    targetAgentId: params.targetAgentId || null,
  })).digest('hex');
}

function isUniqueViolation(error) {
  return error?.number === 2627 || error?.number === 2601;
}

async function findOperationRequestSql(conversationId, operation, clientRequestId, { transaction } = {}) {
  const { rows } = await query(
    `SELECT TOP (1) actor_agent_id, request_hash
     FROM dbo.conversation_operation_requests
     WHERE conversation_id = $1 AND operation = $2 AND client_request_id = $3`,
    [conversationId, operation, clientRequestId],
    { transaction },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    actorAgentId: row.actor_agent_id,
    requestHash: row.request_hash,
  };
}

async function insertOperationRequestSql(entry, { transaction } = {}) {
  await query(
    `INSERT INTO dbo.conversation_operation_requests (
      conversation_id, operation, client_request_id, actor_agent_id, request_hash
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.conversationId,
      entry.operation,
      entry.clientRequestId,
      entry.actorAgentId,
      entry.requestHash,
    ],
    { transaction },
  );
}

async function insertAuditLog(entry, { transaction } = {}) {
  await query(
    `INSERT INTO dbo.audit_logs (
      actor_user_id, entity_type, entity_id, action,
      before_json, after_json, metadata_json
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorUserId || null,
      entry.entityType,
      String(entry.entityId),
      entry.action,
      JSON.stringify(entry.beforeJson ?? null),
      JSON.stringify(entry.afterJson ?? null),
      JSON.stringify({
        ...(entry.metadata || {}),
        actor: entry.metadata?.actor || 'user',
      }),
    ],
    { transaction },
  );
}

const conversationTakeoverService = new ConversationTakeoverService();
export default conversationTakeoverService;
