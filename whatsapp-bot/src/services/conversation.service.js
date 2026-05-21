import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import sessionService from './session.service.js';
import { normalizeTwilioWhatsappNumber } from '../utils/twilio-phone.js';
import { isConversationDbEnabled } from '../db/index.js';

const CHANNEL_WHATSAPP = 'whatsapp';

/** @internal exported for unit tests */
export function buildTwilioConversationFields(event) {
  const fromRaw = event.rawPayload?.From || '';
  const phoneNumber = normalizeTwilioWhatsappNumber(fromRaw || event.phone);
  return {
    channel: CHANNEL_WHATSAPP,
    provider: 'twilio',
    externalUserId: event.userId,
    phoneNumber,
  };
}

/** @internal exported for unit tests */
export function buildSessionSyncPatch(memorySession, engineResult, conversation) {
  return {
    flowId: engineResult.flowId || memorySession?.flowId || conversation.currentFlowId,
    flowVersion: memorySession?.flowVersion || conversation.currentFlowVersion || null,
    currentNodeKey: engineResult.currentNodeId || memorySession?.currentNode || null,
    variablesJson: engineResult.variables || memorySession?.variables || {},
    historyJson: memorySession?.history || [],
  };
}

class ConversationService {
  isEnabled() {
    return isConversationDbEnabled() && conversationRepository.isEnabled();
  }

  /**
   * @param {import('../adapters/twilio/twilio-inbound.adapter.js').toCanonicalTwilioInboundEvent extends Function ? never : any} event
   */
  async findOrCreateTwilioConversation(event) {
    const { externalUserId, phoneNumber } = buildTwilioConversationFields(event);

    let conversation = await conversationRepository.findByChannelAndExternalUserId(
      CHANNEL_WHATSAPP,
      externalUserId,
    );

    if (!conversation && phoneNumber) {
      conversation = await conversationRepository.findByPhoneNumber(phoneNumber);
    }

    if (!conversation) {
      conversation = await conversationRepository.createConversation({
        channel: CHANNEL_WHATSAPP,
        provider: 'twilio',
        externalUserId,
        phoneNumber,
        status: 'bot',
        currentFlowId: event.flowId,
      });
      console.log(
        `[ConversationDB] conversation_created id=${conversation.id} phone=${phoneNumber || 'n/a'}`,
      );
      return { conversation, created: true };
    }

    const patch = {};
    if (phoneNumber && conversation.phoneNumber !== phoneNumber) {
      patch.phoneNumber = phoneNumber;
    }
    if (event.flowId && !conversation.currentFlowId) {
      patch.currentFlowId = event.flowId;
    }
    if (Object.keys(patch).length > 0) {
      conversation = await conversationRepository.updateConversation(conversation.id, patch);
    }

    return { conversation, created: false };
  }

  async persistInboundMessage(conversation, event) {
    const message = await conversationMessageRepository.createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      senderType: 'user',
      body: event.text || '',
      provider: 'twilio',
      providerMessageId: event.messageId || null,
      rawPayloadJson: event.rawPayload || null,
      metadataJson: {
        flowId: event.flowId,
        userId: event.userId,
      },
    });

    await conversationRepository.touchLastMessage(conversation.id);
    return message;
  }

  async persistOutboundBotMessage(conversation, reply, context = {}) {
    const message = await conversationMessageRepository.createMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      senderType: 'bot',
      body: reply || '',
      provider: 'twilio',
      providerMessageId: context.providerMessageId || null,
      metadataJson: {
        flowId: context.flowId || conversation.currentFlowId,
        flowVersion: context.flowVersion || conversation.currentFlowVersion,
        nodeKey: context.nodeKey || conversation.currentNodeKey,
        generatedBy: 'flow_engine',
      },
    });

    await conversationRepository.touchLastMessage(conversation.id);
    return message;
  }

  async getOrCreateActiveSession(conversation, flowContext = {}) {
    let dbSession = await conversationSessionRepository.findActiveByConversationId(
      conversation.id,
    );

    const flowId = flowContext.flowId || conversation.currentFlowId;
    const flowVersion = flowContext.flowVersion || conversation.currentFlowVersion || null;
    const currentNodeKey = flowContext.currentNodeKey || conversation.currentNodeKey || null;

    if (!dbSession) {
      dbSession = await conversationSessionRepository.createSession({
        conversationId: conversation.id,
        flowId: flowId || 'main-menu',
        flowVersion,
        currentNodeKey,
        variablesJson: flowContext.variables || {},
        historyJson: flowContext.history || [],
      });
      console.log(
        `[ConversationDB] session_created id=${dbSession.id} conversation=${conversation.id}`,
      );
      return { session: dbSession, created: true };
    }

    if (flowId && dbSession.flowId !== flowId) {
      await conversationSessionRepository.endSession(dbSession.id);
      dbSession = await conversationSessionRepository.createSession({
        conversationId: conversation.id,
        flowId,
        flowVersion,
        currentNodeKey,
        variablesJson: {},
        historyJson: [],
      });
      return { session: dbSession, created: true, replaced: true };
    }

    return { session: dbSession, created: false };
  }

  /**
   * Hidrata sessionService desde la sesión activa en DB si no hay sesión en memoria.
   */
  async hydrateRuntimeSessionIfNeeded(userId, dbSession, event) {
    const memorySession = sessionService.getSession(userId);
    if (memorySession) return memorySession;

    if (!dbSession) return null;

    const extra = {
      provider: event.provider,
      phone: normalizeTwilioWhatsappNumber(event.rawPayload?.From) || event.phone,
      flowVersion: dbSession.flowVersion,
    };

    await sessionService.createSession(
      userId,
      dbSession.flowId,
      dbSession.currentNodeKey || 'welcome',
      extra,
    );

    await sessionService.updateSession(userId, {
      variables: dbSession.variablesJson || {},
      history: Array.isArray(dbSession.historyJson) ? dbSession.historyJson : [],
      currentNode: dbSession.currentNodeKey,
      flowId: dbSession.flowId,
      flowVersion: dbSession.flowVersion,
    });

    return sessionService.getSession(userId);
  }

  async syncSessionFromFlowEngine(conversation, dbSession, userId, engineResult) {
    const memorySession = sessionService.getSession(userId);
    const sync = buildSessionSyncPatch(memorySession, engineResult, conversation);
    const {
      flowId,
      flowVersion,
      currentNodeKey,
      variablesJson: variables,
      historyJson: history,
    } = sync;

    let activeSession = dbSession;
    if (!activeSession) {
      const created = await this.getOrCreateActiveSession(conversation, {
        flowId,
        flowVersion,
        currentNodeKey,
        variables,
        history,
      });
      activeSession = created.session;
    } else {
      activeSession = await conversationSessionRepository.updateSession(activeSession.id, {
        flowId,
        flowVersion,
        currentNodeKey,
        variablesJson: variables,
        historyJson: history,
      });
    }

    await conversationRepository.updateConversation(conversation.id, {
      currentFlowId: flowId,
      currentFlowVersion: flowVersion,
      currentNodeKey,
      lastMessageAt: new Date(),
    });

    return activeSession;
  }

  async endActiveSessionsForConversation(conversationId) {
    await conversationSessionRepository.endAllActiveForConversation(conversationId);
  }
}

const conversationService = new ConversationService();
export default conversationService;
