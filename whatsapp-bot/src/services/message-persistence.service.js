import conversationService from './conversation.service.js';
import humanHandoffService from './human-handoff.service.js';
import conversationBotLifecycleService from './conversation-bot-lifecycle.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from './session.service.js';
import { isConversationInHumanMode } from '../utils/handoff-detection.js';
import { shouldBlockBotFlow } from '../utils/conversation-handoff-policy.js';
import { isConversationDbEnabled } from '../db/index.js';

function inboundSkipMetadata(conversation, activeHandoff = null) {
  if (conversation.status === 'assigned') {
    return { botSkipped: true, skipReason: 'conversation_assigned' };
  }
  if (conversation.status === 'waiting_human') {
    return { botSkipped: true, skipReason: 'conversation_waiting_human' };
  }
  if (activeHandoff) {
    return { botSkipped: true, skipReason: 'inconsistent_active_handoff' };
  }
  return { botSkipped: true, skipReason: 'conversation_waiting_human' };
}

/**
 * Orquesta persistencia DB en el webhook Twilio sin alterar FlowEngine.
 */
class MessagePersistenceService {
  isEnabled() {
    return conversationService.isEnabled();
  }

  /**
   * Antes del motor: conversación + mensaje inbound + sesión DB + hidratación opcional.
   * @returns {{ conversation: object, dbSession: object | null, skipFlowEngine?: boolean } | null}
   */
  async handleInbound(event) {
    if (!this.isEnabled()) return null;

    const { conversation: initial } = await conversationService.findOrCreateTwilioConversation(event);
    let conversation = await conversationService.reloadConversation(initial);

    if (conversation.status === 'closed') {
      conversation = await conversationService.reopenClosedConversationIfNeeded(conversation);
    }

    if (isConversationInHumanMode(conversation)) {
      await conversationService.persistInboundMessage(
        conversation,
        event,
        inboundSkipMetadata(conversation),
      );
      return { conversation, dbSession: null, skipFlowEngine: true };
    }

    const activeHandoff = await humanHandoffRepository.findLatestActiveByConversationId(
      conversation.id,
    );
    if (shouldBlockBotFlow(conversation, activeHandoff)) {
      await conversationService.persistInboundMessage(
        conversation,
        event,
        inboundSkipMetadata(conversation, activeHandoff),
      );
      return { conversation, dbSession: null, skipFlowEngine: true };
    }

    await conversationService.persistInboundMessage(conversation, event);

    const normalized = await conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded(
      conversation,
    );
    conversation = normalized.conversation;

    const { session: dbSession } = await conversationService.getOrCreateActiveSession(
      conversation,
      { flowId: event.flowId },
    );

    await conversationService.hydrateRuntimeSessionIfNeeded(
      event.userId,
      dbSession,
      event,
      conversation,
    );

    return { conversation, dbSession, skipFlowEngine: false };
  }

  /**
   * Si el runtime resetea sesión (cambio de flow en URL), cerrar sesiones DB activas.
   */
  async handleRuntimeSessionReset(event, conversationContext) {
    if (!this.isEnabled() || !conversationContext?.conversation) return;
    await conversationService.endActiveSessionsForConversation(
      conversationContext.conversation.id,
    );
  }

  /**
   * Después del motor: mensaje outbound + sync sesión/conversación (modo bot).
   */
  async handleOutbound(conversationContext, engineResult, event) {
    if (!this.isEnabled() || !conversationContext?.conversation) return;

    const { conversation, dbSession } = conversationContext;
    const memorySession = sessionService.getSession(event.userId);

    await conversationService.persistOutboundBotMessage(
      conversation,
      engineResult.reply,
      {
        flowId: engineResult.flowId,
        flowVersion: memorySession?.flowVersion,
        nodeKey: engineResult.currentNodeId,
      },
    );

    await conversationService.syncSessionFromFlowEngine(
      conversation,
      dbSession,
      event.userId,
      engineResult,
    );
  }

  /**
   * Tras detectar handoff en el motor: cola humana, pausa sesión, confirma una vez.
   * @returns {{ reply: string, shouldSendTwiml: boolean } | null}
   */
  async handleHumanHandoff(conversationContext, engineResult, event) {
    if (!this.isEnabled() || !conversationContext?.conversation) return null;

    const memorySession = sessionService.getSession(event.userId);
    const handoffResult = await humanHandoffService.processEngineHandoff(
      conversationContext,
      engineResult,
      event,
      { memorySession },
    );

    if (handoffResult.shouldSendConfirmation) {
      await conversationService.persistOutboundBotMessage(
        handoffResult.conversation,
        handoffResult.confirmationMessage,
        {
          flowId: handoffResult.flowId,
          flowVersion: handoffResult.flowVersion,
          nodeKey: handoffResult.nodeKey,
          event: 'human_handoff_requested',
          handoffId: handoffResult.handoff.id,
          handoff: handoffResult.handoff,
        },
      );
    }

    return {
      reply: handoffResult.confirmationMessage,
      shouldSendTwiml: handoffResult.shouldSendConfirmation,
      handoff: handoffResult.handoff,
    };
  }

  /**
   * Envuelve operaciones DB: loguea y no relanza (webhook sigue).
   */
  async safeRun(label, fn) {
    if (!isConversationDbEnabled()) return null;
    try {
      return await fn();
    } catch (error) {
      console.error(`[ConversationDB] ${label} failed:`, error.message);
      if (process.env.CONVERSATION_DB_STRICT === '1') {
        throw error;
      }
      return null;
    }
  }
}

const messagePersistenceService = new MessagePersistenceService();
export default messagePersistenceService;
