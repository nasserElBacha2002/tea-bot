import conversationService from './conversation.service.js';
import humanHandoffService from './human-handoff.service.js';
import conversationBotLifecycleService from './conversation-bot-lifecycle.service.js';
import conversationReentryService from './conversation-reentry.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from './session.service.js';
import { isConversationInHumanMode, resolveHandoffConfirmationMessage } from '../utils/handoff-detection.js';
import { shouldBlockBotFlow } from '../utils/conversation-handoff-policy.js';
import { isConversationDbEnabled } from '../db/index.js';
import { conversationTurnGuard } from './conversation-turn-guard.service.js';

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
    conversation = await conversationService.reloadConversation(conversation);

    const reentry = await conversationReentryService.consumeInbound(conversation, event.text || '');
    if (reentry?.action && reentry.action !== 'delegate') {
      return this.finishReentry(reentry);
    }
    if (reentry?.conversation) conversation = reentry.conversation;

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
   * Una sola respuesta. present_entry y legacy_cleared delegan la presentación al motor,
   * con la sesión en memoria ya reseteada para que el texto no se matchee.
   */
  async finishReentry(reentry, statusVersionAtStart = null) {
    const conversation = reentry.conversation;
    if (reentry.action === 'human_skip') {
      return { conversation, dbSession: null, skipFlowEngine: true, decision: 'SUPPRESS' };
    }
    if (reentry.action === 'present_entry' || reentry.action === 'legacy_cleared') {
      await conversationReentryService.resetRuntime(conversation);
      return { conversation, dbSession: null, skipFlowEngine: false, decision: 'ALLOW' };
    }

    const decision = await this._authorizeBotReply(
      conversation,
      statusVersionAtStart ?? conversation.statusVersion ?? null,
      reentry.reply,
      {
        flowId: conversation.currentFlowId,
        flowVersion: conversation.currentFlowVersion,
        nodeKey: reentry.nodeKey || conversation.currentNodeKey,
        event: reentry.action === 'handoff' ? 'human_handoff_requested' : `reentry_${reentry.action}`,
        handoffId: reentry.handoff?.id,
        handoff: reentry.handoff,
      },
    );
    if (decision.decision === 'SUPPRESS') {
      return {
        conversation: decision.conversation || conversation,
        dbSession: null,
        skipFlowEngine: true,
        suppressedByTakeover: true,
        decision: 'SUPPRESS',
      };
    }
    if (decision.decision !== 'ALLOW') {
      return {
        conversation: decision.conversation || conversation,
        dbSession: null,
        skipFlowEngine: true,
        decision: decision.decision,
        reason: decision.reason,
      };
    }
    if (!decision.persisted) {
      await conversationService.persistOutboundBotMessage(conversation, reentry.reply, {
        flowId: conversation.currentFlowId,
        flowVersion: conversation.currentFlowVersion,
        nodeKey: reentry.nodeKey || conversation.currentNodeKey,
        event: reentry.action === 'handoff' ? 'human_handoff_requested' : `reentry_${reentry.action}`,
        handoffId: reentry.handoff?.id,
        handoff: reentry.handoff,
      });
    }

    return {
      conversation: decision.conversation || conversation,
      dbSession: reentry.dbSession || null,
      skipFlowEngine: true,
      reentryReply: reentry.reply,
      decision: 'ALLOW',
    };
  }

  async _authorizeBotReply(conversation, statusVersionAtStart, reply, context) {
    const decision = await conversationTurnGuard.authorizeAutomaticReply({
      conversation,
      statusVersionAtStart,
      persist: async (transaction, locked) => conversationService.persistOutboundBotMessage(
        locked,
        reply,
        context,
        { transaction, deferNotify: true },
      ),
    });
    if (decision.decision === 'ALLOW' && decision.persisted) {
      await conversationService.publishPersistedOutbound(
        decision.conversation || conversation,
        decision.persisted,
        context,
      );
    }
    return decision;
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
  async handleOutbound(conversationContext, engineResult, event, statusVersionAtStart = null) {
    if (!this.isEnabled() || !conversationContext?.conversation) {
      return { decision: 'ALLOW', reason: 'persistence_disabled' };
    }

    const { conversation, dbSession } = conversationContext;
    const memorySession = sessionService.getSession(event.userId);
    const context = {
      flowId: engineResult.flowId,
      flowVersion: memorySession?.flowVersion,
      nodeKey: engineResult.currentNodeId,
    };
    const decision = await this._authorizeBotReply(
      conversation,
      statusVersionAtStart ?? conversation.statusVersion ?? null,
      engineResult.reply,
      context,
    );
    if (decision.decision !== 'ALLOW') return decision;
    if (!decision.persisted) {
      await conversationService.persistOutboundBotMessage(conversation, engineResult.reply, context);
    }

    await conversationService.syncSessionFromFlowEngine(
      decision.conversation || conversation,
      dbSession,
      event.userId,
      engineResult,
    );
    return { decision: 'ALLOW', reason: decision.reason };
  }

  /**
   * Tras detectar handoff en el motor: cola humana, pausa sesión, confirma una vez.
   * @returns {{ reply: string, shouldSendTwiml: boolean } | null}
   */
  async handleHumanHandoff(conversationContext, engineResult, event) {
    if (!this.isEnabled() || !conversationContext?.conversation) return null;

    const memorySession = sessionService.getSession(event.userId);
    const confirmation = resolveHandoffConfirmationMessage(
      engineResult?.currentNodeId || conversationContext.conversation.currentNodeKey,
      engineResult?.reply,
    );
    let persistedMessage = null;
    const handoffResult = await humanHandoffService.processEngineHandoff(
      conversationContext,
      engineResult,
      event,
      {
        memorySession,
        persistInside: async (transaction, conversation) => {
          persistedMessage = await conversationService.persistOutboundBotMessage(
            conversation,
            confirmation,
            {
              flowId: engineResult?.flowId || conversation.currentFlowId,
              flowVersion: memorySession?.flowVersion || conversation.currentFlowVersion,
              nodeKey: engineResult?.currentNodeId || conversation.currentNodeKey,
              event: 'human_handoff_requested',
            },
            { transaction, deferNotify: true },
          );
        },
      },
    );

    if (handoffResult.aborted || handoffResult.shouldSendConfirmation === false) {
      return {
        reply: null,
        shouldSendTwiml: false,
        aborted: true,
        handoff: handoffResult.handoff,
      };
    }

    if (persistedMessage) {
      await conversationService.publishPersistedOutbound(
        handoffResult.conversation,
        persistedMessage,
        { handoff: handoffResult.handoff },
      );
    }

    return {
      reply: handoffResult.confirmationMessage || confirmation,
      shouldSendTwiml: true,
      handoff: handoffResult.handoff,
    };
  }

  /**
   * Envuelve operaciones DB: loguea y no relanza (webhook sigue).
   */
  /**
   * @param {{ required?: boolean }} [options]
   * required no traga el error cuando la base está habilitada.
   * Si la base está apagada, sigue devolviendo null para que el motor responda sin persistencia.
   */
  async safeRun(label, fn, { required = false } = {}) {
    if (!isConversationDbEnabled()) return null;
    try {
      return await fn();
    } catch (error) {
      console.error(`[ConversationDB] ${label} failed:`, error.message);
      if (required || process.env.CONVERSATION_DB_STRICT === '1') {
        throw error;
      }
      return null;
    }
  }
}

const messagePersistenceService = new MessagePersistenceService();
export default messagePersistenceService;
