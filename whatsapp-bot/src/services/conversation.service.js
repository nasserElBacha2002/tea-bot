import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import sessionService from './session.service.js';
import flowLoader from '../utils/flow-loader.js';
import { normalizeTwilioWhatsappNumber } from '../utils/twilio-phone.js';
import { isConversationDbEnabled } from '../db/index.js';
import { currentInboundLease, withFencedWrite } from '../monitoring/inbound-lease.js';
import {
  notifyConversationCreated,
  notifyConversationMessageCreated,
  notifyConversationUpdated,
} from '../realtime/conversation-live.notify.js';
import { mapHumanHandoffPublic } from '../utils/conversation-inbox.mapper.js';
import conversationReopenService from './conversation-reopen.service.js';
import conversationBotLifecycleService from './conversation-bot-lifecycle.service.js';
import { CHANNEL_WHATSAPP } from '../constants/conversation-channels.js';
import {
  resolveHydrationNodeKey,
  shouldHydrateRuntimeSession,
} from '../utils/conversation-flow-lifecycle.js';

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
  const flowId = engineResult.flowId || memorySession?.flowId || conversation.currentFlowId;
  const cacheVersion = flowId ? flowLoader.getCacheInfo(flowId)?.version : null;
  return {
    flowId,
    flowVersion:
      memorySession?.flowVersion
      || cacheVersion
      || engineResult.flowVersion
      || conversation.currentFlowVersion
      || null,
    currentNodeKey: engineResult.currentNodeId || memorySession?.currentNode || null,
    variablesJson: engineResult.variables || memorySession?.variables || {},
    historyJson: memorySession?.history || [],
    trackingJson: {
      answers: memorySession?.answers || {},
      visitedNodes: memorySession?.visitedNodes || [],
      transitionTrail: memorySession?.transitionTrail || [],
      lastUserMessage: memorySession?.lastUserMessage || null,
      startedAt: memorySession?.startedAt || null,
    },
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
      try {
        await sessionService.resetSession(externalUserId);
      } catch (error) {
        console.warn(
          `[ConversationDB] leftover_runtime_reset_failed id=${conversation.id} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
      notifyConversationCreated(conversation);
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

  async persistOutboundBotMessage(conversation, reply, context = {}, options = {}) {
    const { transaction = null, deferNotify = false } = options;
    const message = await conversationMessageRepository.createMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      senderType: 'bot',
      body: reply || '',
      provider: 'twilio',
      providerMessageId: context.providerMessageId || null,
      metadataJson: {
        generatedBy: context.generatedBy || 'flow_engine',
        flowId: context.flowId || conversation.currentFlowId,
        flowVersion: context.flowVersion || conversation.currentFlowVersion,
        nodeKey: context.nodeKey || conversation.currentNodeKey,
        event: context.event,
        handoffId: context.handoffId,
        ...context.metadataExtra,
      },
    }, { transaction });

    await conversationRepository.updateConversation(
      conversation.id,
      { lastMessageAt: new Date() },
      { transaction },
    );
    if (deferNotify) return message;

    const refreshed = await this.reloadConversation(conversation);
    this._notifyOutbound(refreshed, message, context);
    return message;
  }

  _notifyOutbound(conversation, message, context = {}) {
    const notifyExtras = {};
    if (context.handoff) {
      notifyExtras.humanHandoff = mapHumanHandoffPublic(context.handoff);
    }
    notifyConversationMessageCreated(conversation, message, notifyExtras);
  }

  async publishPersistedOutbound(conversation, message, context = {}) {
    const refreshed = await this.reloadConversation(conversation);
    this._notifyOutbound(refreshed || conversation, message, context);
    return refreshed;
  }

  async getOrCreateActiveSession(conversation, flowContext = {}, options = {}) {
    if (!options.fenced && currentInboundLease()) {
      return withFencedWrite(null, (transaction) =>
        this.getOrCreateActiveSession(conversation, flowContext, { fenced: true, transaction }));
    }
    const transaction = options.transaction;
    let dbSession = await conversationSessionRepository.findActiveByConversationId(
      conversation.id,
      { transaction },
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
      }, { transaction });
      console.log(
        `[ConversationDB] session_created id=${dbSession.id} conversation=${conversation.id}`,
      );
      return { session: dbSession, created: true };
    }

    if (flowId && dbSession.flowId !== flowId) {
      await conversationSessionRepository.updateSession(dbSession.id, {
        status: 'ended',
        endedAt: new Date(),
      }, { transaction });
      dbSession = await conversationSessionRepository.createSession({
        conversationId: conversation.id,
        flowId,
        flowVersion,
        currentNodeKey,
        variablesJson: {},
        historyJson: [],
      }, { transaction });
      return { session: dbSession, created: true, replaced: true };
    }

    return { session: dbSession, created: false };
  }

  /**
   * Hidrata sessionService desde la sesión activa en DB si no hay sesión en memoria.
   * No hidrata si el flujo todavía no se presentó (FIRST_CONTACT).
   */
  async hydrateRuntimeSessionIfNeeded(userId, dbSession, event, conversation = null) {
    const memorySession = sessionService.getSession(userId);
    if (memorySession) return memorySession;

    if (!dbSession) return null;
    if (!shouldHydrateRuntimeSession(dbSession, conversation)) {
      return null;
    }

    const extra = {
      provider: event.provider,
      phone: normalizeTwilioWhatsappNumber(event.rawPayload?.From) || event.phone,
      flowVersion: dbSession.flowVersion,
    };

    const resumeNodeKey = resolveHydrationNodeKey(dbSession, conversation);
    if (!resumeNodeKey) return null;

    await sessionService.createSession(
      userId,
      dbSession.flowId,
      resumeNodeKey,
      extra,
    );

    await sessionService.updateSession(userId, {
      variables: dbSession.variablesJson || {},
      history: Array.isArray(dbSession.historyJson) ? dbSession.historyJson : [],
      currentNode: resumeNodeKey,
      flowId: dbSession.flowId,
      flowVersion: dbSession.flowVersion,
      answers: dbSession.trackingJson?.answers || {},
      visitedNodes: Array.isArray(dbSession.trackingJson?.visitedNodes)
        ? dbSession.trackingJson.visitedNodes
        : [],
      transitionTrail: Array.isArray(dbSession.trackingJson?.transitionTrail)
        ? dbSession.trackingJson.transitionTrail
        : [],
      lastUserMessage: dbSession.trackingJson?.lastUserMessage || '',
      startedAt: dbSession.trackingJson?.startedAt || undefined,
    });

    return sessionService.getSession(userId);
  }

  async syncSessionFromFlowEngine(conversation, dbSession, userId, engineResult, existingTransaction = null) {
    if (existingTransaction) {
      return this.syncSessionFromFlowEngineUnlocked(
        conversation,
        dbSession,
        userId,
        engineResult,
        existingTransaction,
      );
    }
    if (currentInboundLease()) {
      return withFencedWrite(null, (transaction) =>
        this.syncSessionFromFlowEngineUnlocked(conversation, dbSession, userId, engineResult, transaction));
    }
    return this.syncSessionFromFlowEngineUnlocked(conversation, dbSession, userId, engineResult, null);
  }

  async syncSessionFromFlowEngineUnlocked(conversation, dbSession, userId, engineResult, transaction) {
    const memorySession = sessionService.getSession(userId);
    const sync = buildSessionSyncPatch(memorySession, engineResult, conversation);
    const {
      flowId,
      flowVersion,
      currentNodeKey,
      variablesJson: variables,
      historyJson: history,
      trackingJson,
    } = sync;

    const updated = await conversationRepository.updateFlowPositionIfNoReentry(conversation.id, {
      currentFlowId: flowId,
      currentFlowVersion: flowVersion,
      currentNodeKey,
      lastMessageAt: new Date(),
    }, { transaction, fenced: Boolean(transaction) });
    if (!updated) {
      try {
        await sessionService.resetSession(userId);
      } catch (error) {
        console.warn(
          `[ConversationDB] reentry_sync_reset_failed user=${userId} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }

    let activeSession = dbSession;
    if (!activeSession) {
      const created = await this.getOrCreateActiveSession(updated, {
        flowId,
        flowVersion,
        currentNodeKey,
        variables,
        history,
      }, { fenced: true, transaction });
      activeSession = created.session;
    } else {
      activeSession = await conversationSessionRepository.updateSession(activeSession.id, {
        flowId,
        flowVersion,
        currentNodeKey,
        variablesJson: variables,
        historyJson: history,
        trackingJson,
      }, { transaction });
    }

    return activeSession;
  }

  async endActiveSessionsForConversation(conversationId) {
    return withFencedWrite(null, (transaction) =>
      conversationSessionRepository.endAllOpenForConversation(
        conversationId,
        new Date(),
        { transaction },
      ));
  }

  async updateStatus(conversationId, status) {
    return conversationRepository.updateConversation(conversationId, { status });
  }

  async markWaitingHuman(conversationId, currentNodeKey) {
    const updated = await conversationRepository.updateConversation(conversationId, {
      status: 'waiting_human',
      assignedAgentId: null,
      currentNodeKey,
    });
    notifyConversationUpdated(updated);
    return updated;
  }

  async markAssigned(conversationId, agentId) {
    return conversationRepository.updateConversation(conversationId, {
      status: 'assigned',
      assignedAgentId: agentId,
    });
  }

  async markBotActive(conversationId) {
    return conversationRepository.updateConversation(conversationId, {
      status: 'bot',
      assignedAgentId: null,
    });
  }

  async closeConversation(conversationId, _reason) {
    return this.returnConversationToBot(conversationId);
  }

  async returnConversationToBot(conversationId) {
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) return null;
    const { conversation: updated } = await conversationBotLifecycleService.returnConversationToBot(
      conversation,
    );
    return updated;
  }

  async reloadConversation(conversation) {
    if (!conversation?.id) return conversation;
    return (await conversationRepository.findById(conversation.id)) || conversation;
  }

  /**
   * Reabre una conversación cerrada antes de persistir un mensaje entrante.
   * @returns {Promise<object>} conversación actualizada (reabierta o sin cambios)
   */
  async reopenClosedConversationIfNeeded(conversation, context = {}) {
    const result = await conversationReopenService.reopenFromInboundMessage(conversation, context);
    return result.conversation;
  }

  async persistInboundMessage(conversation, event, extraMetadata = {}) {
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
        ...extraMetadata,
      },
    });

    await conversationRepository.touchLastMessage(conversation.id);
    const refreshed = await this.reloadConversation(conversation);
    notifyConversationMessageCreated(refreshed, message);
    return message;
  }
}

const conversationService = new ConversationService();
export default conversationService;
