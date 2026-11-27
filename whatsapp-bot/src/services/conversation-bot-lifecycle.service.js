import { withTransaction } from '../db/index.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from './session.service.js';
import { resolveResumeNodeKey } from './flow-entry-node.service.js';
import { evaluateLegacyNormalizationCandidate, isHandoffTerminalNode } from '../utils/conversation-handoff-policy.js';
import {
  buildReentrySnapshot,
  resolveReentryPolicy,
} from '../utils/conversation-reentry-policy.js';
import { canTakeoverConversation } from '../auth/roles.js';
import { agentsMatch } from '../utils/agent-identity.js';
import { isManualTakeoverEnabled } from '../utils/manual-takeover-flag.js';
import {
  ERROR_CODES,
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
  ensureCorrelationId,
  logAttentionTransition,
  logLegacyAttentionEvent,
  outcomeFromError,
} from './conversation-attention-transition-log.js';

function returnAuthError(code, message, httpStatus, details) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.apiError = code;
  error.apiMessage = message;
  if (details) error.details = details;
  return error;
}

/**
 * La fila ya está bloqueada. Sin actor, el cierre es interno y no pasa por HTTP.
 * Con actor y toma activa, el inbox del panel (admin y operador) es compartido:
 * cualquiera de las dos cuentas habilitadas puede devolver o cerrar aunque no
 * sea el assigned_agent_id. Con la toma apagada se conserva el mismo criterio.
 */
export function assertExclusiveReturnAllowed(locked, actor, {
  takeoverEnabled = isManualTakeoverEnabled(),
} = {}) {
  if (!actor?.agentId || !canTakeoverConversation(actor.role)) {
    throw returnAuthError(
      'FORBIDDEN',
      'No tenés permiso para devolver esta conversación al bot.',
      403,
    );
  }
  if (!takeoverEnabled) return;

  const exclusive = Boolean(locked?.assignedAgentId)
    && (locked.status === 'assigned' || locked.status === 'paused');
  if (!exclusive || agentsMatch(locked.assignedAgentId, actor.agentId)) return;
  if (canTakeoverConversation(actor.role)) return;

  throw returnAuthError(
    'CONVERSATION_OWNED',
    'La conversación está asignada a otro agente.',
    409,
    { assignedAgentId: locked.assignedAgentId },
  );
}

export { isHandoffTerminalNode };

/**
 * Transición centralizada: devolver conversación al bot con estado coherente.
 */
export class ConversationBotLifecycleService {
  /**
   * @param {{
   *   conversationRepo?: typeof conversationRepository,
   *   sessionRepo?: typeof conversationSessionRepository,
   *   handoffRepo?: typeof humanHandoffRepository,
   *   runtimeSession?: typeof sessionService,
   *   runTransaction?: typeof withTransaction,
   *   logTransition?: typeof logAttentionTransition,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
    this.handoffRepo = deps.handoffRepo || humanHandoffRepository;
    this.runtimeSession = deps.runtimeSession || sessionService;
    this.runTransaction = deps.runTransaction || withTransaction;
    this.logTransition = deps.logTransition || logAttentionTransition;
  }

  /**
   * @param {object} conversation
   */
  async resetRuntimeSessionSafe(conversation, logContext = {}) {
    if (!conversation?.externalUserId) return { reset: false, failed: false };

    try {
      await this.runtimeSession.resetSession(conversation.externalUserId);
      return { reset: true, failed: false };
    } catch (error) {
      const correlationId = ensureCorrelationId(logContext.correlationId);
      this.logTransition({
        transitionType: TRANSITION_TYPES.returnToBot,
        outcome: OUTCOMES.error,
        conversationId: conversation.id,
        correlationId,
        reasonCode: logContext.reasonCode,
        actorKind: logContext.actorAgentId ? 'operator' : 'system',
        actorAgentId: logContext.actorAgentId,
        errorCode: ERROR_CODES.runtimeResetFailed,
      });
      logLegacyAttentionEvent('conversation_runtime_reset_failed', {
        conversationId: conversation.id,
        correlationId,
        errorCode: ERROR_CODES.runtimeResetFailed,
        outcome: OUTCOMES.error,
      });
      return { reset: false, failed: true };
    }
  }

  /**
   * @param {object} conversation
   * @param {{ resolutionNote?: string | null }} [options]
   */
  async returnConversationToBot(conversation, options = {}) {
    const startedAt = Date.now();
    const conversationId = conversation.id;
    const previousNodeKey = conversation.currentNodeKey ?? null;
    const correlationId = ensureCorrelationId(options.correlationId || options.clientRequestId);
    const reasonCode = options.reasonCode || REASON_CODES.returnToBot;
    const actorAgentId = options.actor?.agentId || null;
    const reentryPolicy = resolveReentryPolicy();
    const promptReentry = reentryPolicy === 'prompt';
    const degradedReentry = reentryPolicy === 'degraded';
    const memorySession = typeof this.runtimeSession.getSession === 'function'
      ? this.runtimeSession.getSession(conversation.externalUserId)
      : null;
    const resolvedAt = new Date();

    try {
    const txResult = await this.runTransaction(async (transaction) => {
      const locked = await this.conversationRepo.findByIdForUpdate(conversationId, { transaction });
      if (!locked) {
        const err = new Error('Conversation not found');
        err.code = 'NOT_FOUND';
        throw err;
      }

      if (options.actor) {
        assertExclusiveReturnAllowed(locked, options.actor, {
          takeoverEnabled: options.takeoverEnabled ?? isManualTakeoverEnabled(),
        });
      }

      const openSession = await this.sessionRepo.findLatestOpenByConversationId(
        conversationId,
        { transaction },
      );

      const resolvedHandoffIds = await this.handoffRepo.resolveActiveHandoffs(
        conversationId,
        {
          resolutionNote: options.resolutionNote ?? null,
          resolvedAt,
        },
        { transaction },
      );

      const endedSessionCount = await this.sessionRepo.endAllOpenForConversation(
        conversationId,
        resolvedAt,
        { transaction },
      );

      const existingReentry = locked.reentryJson;
      const keepExisting = existingReentry
        && (existingReentry.status === 'pending' || existingReentry.status === 'awaiting_choice');
      const returningFromHuman = locked.status === 'waiting_human'
        || locked.status === 'assigned'
        || locked.status === 'paused'
        || isHandoffTerminalNode(locked.currentNodeKey)
        || resolvedHandoffIds.length > 0;

      let reentryJson = null;
      let resumeNodeKey = null;
      let writeReentry = true;
      if (promptReentry && keepExisting) {
        reentryJson = existingReentry;
      } else if (promptReentry && returningFromHuman) {
        reentryJson = buildReentrySnapshot({
          conversation: locked,
          openSession,
          memorySession,
          capturedAt: resolvedAt.toISOString(),
        });
      } else if (degradedReentry && (keepExisting || returningFromHuman)) {
        resumeNodeKey = null;
        writeReentry = false;
      } else {
        resumeNodeKey = await resolveResumeNodeKey(locked);
      }

      const patch = {
        status: 'bot',
        assignedAgentId: null,
        closedAt: null,
        currentNodeKey: resumeNodeKey,
        incrementStatusVersion: true,
      };
      if (writeReentry) patch.reentryJson = reentryJson;

      const updated = await this.conversationRepo.updateConversation(
        conversationId,
        patch,
        { transaction },
      );

      const transitionApplied = locked.status !== 'bot'
        || resolvedHandoffIds.length > 0
        || endedSessionCount > 0;

      return {
        conversation: updated,
        resolvedHandoffIds,
        endedSessionCount,
        resumeNodeKey,
        reentryArmed: Boolean(reentryJson),
        lockedPreviousStatus: locked.status,
        transitionApplied,
      };
    });

    const runtimeResult = await this.resetRuntimeSessionSafe(txResult.conversation, {
      correlationId,
      reasonCode,
      actorAgentId,
    });

    const outcome = txResult.transitionApplied ? OUTCOMES.confirmed : OUTCOMES.idempotentReplay;
    this.logTransition({
      transitionType: TRANSITION_TYPES.returnToBot,
      outcome,
      conversationId,
      correlationId,
      previousStatus: txResult.lockedPreviousStatus,
      newStatus: 'bot',
      reasonCode,
      actorKind: options.actor?.agentId ? 'operator' : 'system',
      actorAgentId,
      resumeNodeKey: txResult.resumeNodeKey,
      reentryArmed: txResult.reentryArmed,
      resolvedHandoffCount: txResult.resolvedHandoffIds.length,
      resolvedHandoffIds: txResult.resolvedHandoffIds,
      endedSessionCount: txResult.endedSessionCount,
      runtimeReset: runtimeResult.reset,
      runtimeResetFailed: runtimeResult.failed,
      statusVersion: txResult.conversation?.statusVersion ?? null,
      durationMs: Date.now() - startedAt,
      nodeKey: previousNodeKey,
    });
    if (outcome === OUTCOMES.confirmed) {
      logLegacyAttentionEvent('conversation_returned_to_bot', {
        conversationId,
        correlationId,
        previousStatus: txResult.lockedPreviousStatus,
        newStatus: 'bot',
        reasonCode,
        resolvedHandoffCount: txResult.resolvedHandoffIds.length,
        resolvedHandoffIds: txResult.resolvedHandoffIds,
        endedSessionCount: txResult.endedSessionCount,
        reentryArmed: txResult.reentryArmed,
        runtimeReset: runtimeResult.reset,
        runtimeResetFailed: runtimeResult.failed,
        resumeNodeKey: txResult.resumeNodeKey,
        nodeKey: previousNodeKey,
      });
    }

    return {
      conversation: txResult.conversation,
      resumeNodeKey: txResult.resumeNodeKey,
      reentryArmed: txResult.reentryArmed,
      resolvedHandoffIds: txResult.resolvedHandoffIds,
      endedSessionCount: txResult.endedSessionCount,
    };
    } catch (error) {
      const { outcome, errorCode } = outcomeFromError(error);
      this.logTransition({
        transitionType: TRANSITION_TYPES.returnToBot,
        outcome,
        conversationId,
        correlationId,
        previousStatus: conversation?.status ?? null,
        newStatus: conversation?.status ?? null,
        reasonCode,
        actorKind: options.actor?.agentId ? 'operator' : 'system',
        actorAgentId,
        errorCode,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  /**
   * Corrige estados legacy incoherentes (bot + nodo terminal de handoff sin handoff activo).
   * Toda decisión de normalización ocurre bajo lock de Conversation.
   * @param {object} conversation
   */
  async normalizeLegacyBotStateIfNeeded(conversation) {
    if (!conversation?.id || conversation.status !== 'bot') {
      return { conversation, normalized: false };
    }

    const resumeNodeKey = await resolveResumeNodeKey(conversation);
    const endedAt = new Date();
    const previousNodeKey = conversation.currentNodeKey ?? null;
    const correlationId = ensureCorrelationId();

    const txResult = await this.runTransaction(async (transaction) => {
      const locked = await this.conversationRepo.findByIdForUpdate(conversation.id, { transaction });
      if (!locked || locked.status !== 'bot') {
        return { normalized: false, conversation: locked || conversation };
      }

      const activeHandoffs = await this.handoffRepo.findActiveByConversationIdForUpdate(
        conversation.id,
        { transaction },
      );
      const activeHandoff = activeHandoffs[0] || null;

      const openSession = await this.sessionRepo.findLatestOpenByConversationId(
        conversation.id,
        { transaction },
      );

      const evaluation = evaluateLegacyNormalizationCandidate({
        conversation: locked,
        activeHandoff,
        openSession,
      });
      if (!evaluation.shouldNormalize) {
        return { normalized: false, conversation: locked, reason: evaluation.reason };
      }

      const endedSessionCount = await this.sessionRepo.endAllOpenForConversation(
        conversation.id,
        endedAt,
        { transaction },
      );

      const patched = await this.conversationRepo.updateConversation(
        conversation.id,
        { currentNodeKey: resumeNodeKey },
        { transaction },
      );

      return {
        normalized: true,
        conversation: patched,
        endedSessionCount,
      };
    });

    if (!txResult.normalized) {
      return { conversation: txResult.conversation, normalized: false };
    }

    await this.resetRuntimeSessionSafe(txResult.conversation, { correlationId });

    this.logTransition({
      transitionType: TRANSITION_TYPES.legacyNormalize,
      outcome: OUTCOMES.confirmed,
      conversationId: conversation.id,
      correlationId,
      previousStatus: 'bot',
      newStatus: 'bot',
      actorKind: 'system',
      reasonCode: REASON_CODES.legacyNormalize,
      resumeNodeKey,
      nodeKey: previousNodeKey,
      endedSessionCount: txResult.endedSessionCount,
    });
    logLegacyAttentionEvent('conversation_legacy_state_normalized', {
      conversationId: conversation.id,
      correlationId,
      previousNodeKey,
      resumeNodeKey,
      endedSessionCount: txResult.endedSessionCount,
    });

    return {
      conversation: txResult.conversation,
      normalized: true,
      resumeNodeKey,
    };
  }
}

const conversationBotLifecycleService = new ConversationBotLifecycleService();
export default conversationBotLifecycleService;
