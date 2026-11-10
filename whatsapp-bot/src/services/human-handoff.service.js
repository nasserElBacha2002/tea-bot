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

/**
 * @typedef {object} HandoffContext
 * @property {string} [requestedBy]
 * @property {string} [reason]
 * @property {string} [nodeKey]
 * @property {string} [flowId]
 * @property {string} [flowVersion]
 */

export class HumanHandoffService {
  /**
   * @param {{
   *   handoffRepo?: typeof humanHandoffRepository,
   *   conversationRepo?: typeof conversationRepository,
   *   sessionRepo?: typeof conversationSessionRepository,
   *   runTransaction?: typeof withTransaction,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.handoffRepo = deps.handoffRepo || humanHandoffRepository;
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
    this.runTransaction = deps.runTransaction || withTransaction;
  }

  isConversationInHumanMode(conversation) {
    return isConversationInHumanMode(conversation);
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
    const { engineResult, dbSession = null, event = {} } = params;
    const memorySession = params.memorySession;
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

      return { aborted: false, handoff, created, conversation: updatedConversation, session: pausedSession };
    };

    const txResult = params.transaction
      ? await run(params.transaction)
      : await this.runTransaction(run);

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
