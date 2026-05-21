import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
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
   * }} [deps]
   */
  constructor(deps = {}) {
    this.handoffRepo = deps.handoffRepo || humanHandoffRepository;
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
  }

  isConversationInHumanMode(conversation) {
    return isConversationInHumanMode(conversation);
  }

  /**
   * @param {object} conversation
   * @param {HandoffContext} context
   */
  async ensurePendingHandoff(conversation, context = {}) {
    const existing = await this.handoffRepo.findPendingByConversationId(conversation.id);
    if (existing) return { handoff: existing, created: false };

    const handoff = await this.handoffRepo.createHandoff({
      conversationId: conversation.id,
      requestedBy: context.requestedBy || 'bot',
      reason: context.reason || null,
      status: 'pending',
    });
    return { handoff, created: true };
  }

  /**
   * @param {object} conversation
   * @param {object | null} dbSession
   * @param {HandoffContext} handoffContext
   */
  async pauseConversationForHuman(conversation, dbSession, handoffContext = {}) {
    const nodeKey = handoffContext.nodeKey || conversation.currentNodeKey || 'human_handoff';
    const flowId = handoffContext.flowId || conversation.currentFlowId;
    const flowVersion = handoffContext.flowVersion || conversation.currentFlowVersion;

    const updatedConversation = await this.conversationRepo.updateConversation(conversation.id, {
      status: 'waiting_human',
      assignedAgentId: null,
      currentNodeKey: nodeKey,
      currentFlowId: flowId,
      currentFlowVersion: flowVersion,
    });

    let pausedSession = dbSession;
    if (pausedSession) {
      pausedSession = await this.sessionRepo.updateSession(pausedSession.id, {
        status: 'paused',
        currentNodeKey: nodeKey,
        flowId,
        flowVersion,
      });
    } else {
      const active = await this.sessionRepo.findActiveByConversationId(conversation.id);
      if (active) {
        pausedSession = await this.sessionRepo.updateSession(active.id, {
          status: 'paused',
          currentNodeKey: nodeKey,
        });
      }
    }

    return { conversation: updatedConversation, session: pausedSession };
  }

  /**
   * @param {object} conversation
   * @param {{ engineResult: object, dbSession?: object | null, event?: object }} params
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

    const wasBot = String(conversation.status || 'bot') === 'bot';
    const { handoff, created } = await this.ensurePendingHandoff(conversation, {
      requestedBy: 'bot',
      reason: engineResult?.terminalReason || 'human_handoff',
      nodeKey,
      flowId,
      flowVersion,
    });

    const { conversation: updatedConversation, session } = await this.pauseConversationForHuman(
      conversation,
      dbSession,
      { nodeKey, flowId, flowVersion },
    );

    const confirmationMessage = resolveHandoffConfirmationMessage(
      nodeKey,
      engineResult?.reply,
    );

    return {
      handoff,
      created,
      conversation: updatedConversation,
      session,
      confirmationMessage,
      shouldSendConfirmation: wasBot,
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
    });
  }

  isEngineHandoffResult(engineResult) {
    return isEngineHumanHandoffResult(engineResult);
  }
}

const humanHandoffService = new HumanHandoffService();
export default humanHandoffService;
