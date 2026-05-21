import conversationService from './conversation.service.js';
import sessionService from './session.service.js';
import { isConversationDbEnabled } from '../db/index.js';

/**
 * Orquesta persistencia DB en el webhook Twilio sin alterar FlowEngine.
 */
class MessagePersistenceService {
  isEnabled() {
    return conversationService.isEnabled();
  }

  /**
   * Antes del motor: conversación + mensaje inbound + sesión DB + hidratación opcional.
   * @returns {{ conversation: object, dbSession: object | null } | null}
   */
  async handleInbound(event) {
    if (!this.isEnabled()) return null;

    const { conversation } = await conversationService.findOrCreateTwilioConversation(event);
    await conversationService.persistInboundMessage(conversation, event);

    const { session: dbSession } = await conversationService.getOrCreateActiveSession(
      conversation,
      { flowId: event.flowId },
    );

    await conversationService.hydrateRuntimeSessionIfNeeded(
      event.userId,
      dbSession,
      event,
    );

    return { conversation, dbSession };
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
   * Después del motor: mensaje outbound + sync sesión/conversación.
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
