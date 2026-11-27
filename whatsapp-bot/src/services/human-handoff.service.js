import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import { withTransaction } from '../db/index.js';
import { fenceInboundLease } from '../monitoring/inbound-lease.js';
import { notifyConversationUpdated } from '../realtime/conversation-live.notify.js';
import { mapHumanHandoffPublic } from '../utils/conversation-inbox.mapper.js';
import {
  isConversationInHumanMode,
  isEngineHumanHandoffResult,
  resolveHandoffConfirmationMessage,
} from '../utils/handoff-detection.js';
import {
  OUTCOMES,
  TRANSITION_TYPES,
  ensureCorrelationId,
  logAttentionTransition,
  outcomeFromError,
  reasonCodeForHandoff,
} from './conversation-attention-transition-log.js';

/**
 * @typedef {object} HandoffContext
 * @property {string} [requestedBy]
 * @property {string} [reason]
 * @property {string} [nodeKey]
 * @property {string} [flowId]
 * @property {string} [flowVersion]
 */

function buildHandoffTelemetry({
  conversationId,
  correlationId,
  startedAt,
  reasonCode,
  txResult,
}) {
  return {
    conversationId,
    correlationId,
    startedAt,
    reasonCode,
    txResult,
  };
}

export class HumanHandoffService {
  /**
   * @param {{
   *   handoffRepo?: typeof humanHandoffRepository,
   *   conversationRepo?: typeof conversationRepository,
   *   sessionRepo?: typeof conversationSessionRepository,
   *   runTransaction?: typeof withTransaction,
   *   logTransition?: typeof logAttentionTransition,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.handoffRepo = deps.handoffRepo || humanHandoffRepository;
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
    this.runTransaction = deps.runTransaction || withTransaction;
    this.logTransition = deps.logTransition || logAttentionTransition;
  }

  isConversationInHumanMode(conversation) {
    return isConversationInHumanMode(conversation);
  }

  emitCommittedHandoffTransition(telemetry) {
    if (!telemetry) return;
    const { correlationId, startedAt, reasonCode, txResult } = telemetry;
    const durationMs = Date.now() - (startedAt || Date.now());
    if (txResult?.aborted) {
      this.logTransition({
        transitionType: TRANSITION_TYPES.botHandoff,
        outcome: OUTCOMES.aborted,
        conversationId: telemetry.conversationId,
        correlationId,
        previousStatus: txResult.lockedPreviousStatus,
        newStatus: txResult.conversation?.status ?? txResult.lockedPreviousStatus,
        reasonCode,
        actorKind: 'bot',
        durationMs,
      });
      return;
    }
    this.logTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: txResult.transitionApplied ? OUTCOMES.confirmed : OUTCOMES.idempotentReplay,
      conversationId: txResult.conversation?.id || telemetry.conversationId,
      handoffId: txResult.handoff?.id ?? null,
      correlationId,
      previousStatus: txResult.lockedPreviousStatus,
      newStatus: txResult.conversation?.status ?? 'waiting_human',
      reasonCode,
      actorKind: 'bot',
      handoffCreated: Boolean(txResult.created),
      statusVersion: txResult.conversation?.statusVersion ?? null,
      durationMs,
    });
  }

  /**
   * @param {object} conversation
   * @param {HandoffContext} context
   */
  async ensurePendingHandoff(conversation, context = {}) {
    return this.runTransaction(async (transaction) => {
      await this.conversationRepo.findByIdForUpdate(conversation.id, { transaction });
      return this.handoffRepo.ensurePendingHandoffAtomic(
        conversation.id,
        {
          requestedBy: context.requestedBy || 'bot',
          reason: context.reason || null,
        },
        { transaction },
      );
    });
  }

  /**
   * Transición atómica: handoff pending + conversation waiting_human + session paused.
   * Realtime/outbound ocurren después del commit.
   *
   * @param {object} conversation
   * @param {{ engineResult: object, dbSession?: object | null, event?: object, memorySession?: object }} params
   */
  async requestHumanHandoff(conversation, params = {}) {
    const startedAt = Date.now();
    const { engineResult, dbSession = null, event = {} } = params;
    const memorySession = params.memorySession;
    const correlationId = ensureCorrelationId(event);
    const reasonCode = reasonCodeForHandoff(engineResult?.terminalReason);
    const nodeKey =
      engineResult?.currentNodeId
      || conversation.currentNodeKey
      || 'human_handoff';
    const flowId = engineResult?.flowId || event?.flowId || conversation.currentFlowId;
    const flowVersion =
      memorySession?.flowVersion
      || conversation.currentFlowVersion
      || null;

    const run = async (transaction) => {
      await fenceInboundLease(transaction);
      const locked = await this.conversationRepo.findByIdForUpdate(conversation.id, { transaction });
      if (!locked || locked.status !== 'bot') {
        return {
          aborted: true,
          handoff: null,
          created: false,
          conversation: locked || conversation,
          session: dbSession,
          lockedPreviousStatus: locked?.status ?? conversation?.status ?? null,
        };
      }

      const { handoff, created } = await this.handoffRepo.ensurePendingHandoffAtomic(
        conversation.id,
        {
          requestedBy: 'bot',
          reason: engineResult?.terminalReason || 'human_handoff',
        },
        { transaction },
      );

      const conversationPatch = {
        status: 'waiting_human',
        assignedAgentId: null,
        currentNodeKey: nodeKey,
        currentFlowId: flowId,
        currentFlowVersion: flowVersion,
        incrementStatusVersion: true,
      };
      if (params.clearReentry) conversationPatch.reentryJson = null;

      const updatedConversation = await this.conversationRepo.updateConversation(
        conversation.id,
        conversationPatch,
        { transaction },
      );

      let pausedSession = dbSession;
      if (pausedSession) {
        pausedSession = await this.sessionRepo.updateSession(
          pausedSession.id,
          {
            status: 'paused',
            currentNodeKey: nodeKey,
            flowId,
            flowVersion,
          },
          { transaction },
        );
      } else {
        const active = await this.sessionRepo.findActiveByConversationId(conversation.id, {
          transaction,
        });
        if (active) {
          pausedSession = await this.sessionRepo.updateSession(
            active.id,
            {
              status: 'paused',
              currentNodeKey: nodeKey,
              flowId,
              flowVersion,
            },
            { transaction },
          );
        }
      }

      if (typeof params.persistInside === 'function') {
        await params.persistInside(transaction, updatedConversation);
      }

      return {
        aborted: false,
        handoff,
        created,
        conversation: updatedConversation,
        session: pausedSession,
        lockedPreviousStatus: locked.status,
        transitionApplied: locked.status === 'bot',
      };
    };

    const ownsCommit = !params.transaction;
    let txResult;
    try {
      txResult = params.transaction
        ? await run(params.transaction)
        : await this.runTransaction(run);
    } catch (error) {
      if (ownsCommit) {
        const { outcome, errorCode } = outcomeFromError(error);
        this.logTransition({
          transitionType: TRANSITION_TYPES.botHandoff,
          outcome,
          conversationId: conversation.id,
          correlationId,
          reasonCode,
          actorKind: 'bot',
          errorCode,
          durationMs: Date.now() - startedAt,
        });
      }
      throw error;
    }

    const telemetry = buildHandoffTelemetry({
      conversationId: conversation.id,
      correlationId,
      startedAt,
      reasonCode,
      txResult,
    });

    if (ownsCommit) {
      this.emitCommittedHandoffTransition(telemetry);
    }

    if (txResult.aborted) {
      return {
        aborted: true,
        handoff: null,
        created: false,
        conversation: txResult.conversation,
        session: txResult.session,
        confirmationMessage: null,
        shouldSendConfirmation: false,
        nodeKey,
        flowId,
        flowVersion,
        handoffTelemetry: ownsCommit ? null : telemetry,
      };
    }

    if (!params.deferNotify) {
      notifyConversationUpdated(txResult.conversation, {
        humanHandoff: mapHumanHandoffPublic(txResult.handoff),
      });
    }

    const confirmationMessage = resolveHandoffConfirmationMessage(
      nodeKey,
      engineResult?.reply,
    );

    return {
      handoff: txResult.handoff,
      created: txResult.created,
      conversation: txResult.conversation,
      session: txResult.session,
      confirmationMessage,
      shouldSendConfirmation: true,
      nodeKey,
      flowId,
      flowVersion,
      handoffTelemetry: ownsCommit ? null : telemetry,
    };
  }

  /**
   * @param {object} conversationContext
   * @param {object} engineResult
   * @param {object} [event]
   */
  async processEngineHandoff(conversationContext, engineResult, event = {}, options = {}) {
    const { conversation, dbSession } = conversationContext;
    return this.requestHumanHandoff(conversation, {
      engineResult,
      dbSession,
      event,
      memorySession: options.memorySession,
      persistInside: options.persistInside,
    });
  }

  isEngineHandoffResult(engineResult) {
    return isEngineHumanHandoffResult(engineResult);
  }
}

const humanHandoffService = new HumanHandoffService();
export default humanHandoffService;
