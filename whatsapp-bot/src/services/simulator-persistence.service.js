import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import conversationService from './conversation.service.js';
import humanHandoffService from './human-handoff.service.js';
import sessionService from './session.service.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import { isConversationDbEnabled } from '../db/index.js';
import {
  notifyConversationClosed,
  notifyConversationCreated,
  notifyConversationMessageCreated,
  notifyConversationUpdated,
} from '../realtime/conversation-live.notify.js';
import conversationReopenService from './conversation-reopen.service.js';
import { mapHumanHandoffPublic } from '../utils/conversation-inbox.mapper.js';
import {
  isConversationInHumanMode,
  isEngineHumanHandoffResult,
} from '../utils/handoff-detection.js';

export const SIMULATOR_CHANNEL = 'simulator';
export const SIMULATOR_PROVIDER = 'internal';

export function simulatorExternalUserId(sessionId) {
  return `simulator:${sessionId}`;
}

export function simulatorRuntimeUserId(sessionId) {
  return `simulator:${sessionId}`;
}

export function displayNameForSimulatorStatus(status) {
  switch (status) {
    case 'waiting_human':
      return 'Simulación - Esperando humano';
    case 'assigned':
      return 'Simulación - Asignada';
    case 'closed':
      return 'Simulación - Cerrada';
    case 'paused':
      return 'Simulación - Pausada';
    default:
      return 'Simulación - Bot activo';
  }
}

class SimulatorPersistenceService {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async ensureReady() {
    if (!this.isEnabled()) return false;
    await ensureConversationDbReady();
    return true;
  }

  async findBySessionId(sessionId) {
    return conversationRepository.findByChannelAndExternalUserId(
      SIMULATOR_CHANNEL,
      simulatorExternalUserId(sessionId),
    );
  }

  async findActiveBySessionId(sessionId) {
    const conv = await this.findBySessionId(sessionId);
    if (!conv || conv.status === 'closed') return null;
    return conv;
  }

  async closeSessionConversation(sessionId) {
    if (!(await this.ensureReady())) return null;
    const conv = await this.findBySessionId(sessionId);
    if (!conv || conv.status === 'closed') return null;
    const closed = await conversationRepository.updateConversation(conv.id, {
      status: 'closed',
      closedAt: new Date(),
      displayName: displayNameForSimulatorStatus('closed'),
    });
    notifyConversationClosed(closed);
    return closed;
  }

  async findOrCreateSessionConversation(sessionId, { flowId, flowVersion }) {
    let conv = await this.findBySessionId(sessionId);
    if (conv) {
      if (conv.status === 'closed') {
        const reopened = await conversationReopenService.reopenFromInboundMessage(conv, {
          flowId,
        });
        conv = reopened.conversation;
      }
      return { conversation: conv, created: false };
    }

    const created = await conversationRepository.createConversation({
      channel: SIMULATOR_CHANNEL,
      provider: SIMULATOR_PROVIDER,
      externalUserId: simulatorExternalUserId(sessionId),
      displayName: displayNameForSimulatorStatus('bot'),
      status: 'bot',
      currentFlowId: flowId ?? null,
      currentFlowVersion: flowVersion ?? null,
    });

    notifyConversationCreated(created);
    return { conversation: created, created: true };
  }

  async persistInboundUserMessage(conversation, sessionId, text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) return null;
    return conversationMessageRepository.createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      senderType: 'user',
      body: trimmed,
      provider: SIMULATOR_PROVIDER,
      metadataJson: { generatedBy: 'simulator', sessionId },
    });
  }

  async emitUserInbound(conversation, inbound) {
    if (!inbound) return;
    const updated = await conversationRepository.updateConversation(conversation.id, {
      lastMessageAt: new Date(),
    });
    notifyConversationMessageCreated(updated, inbound);
  }

  /**
   * Persiste entrada del usuario ANTES de ejecutar FlowEngine y emite WebSocket.
   */
  async persistUserInputBeforeEngine({ sessionId, text, flowId = null, flowVersion = null }) {
    if (!(await this.ensureReady())) return null;

    const trimmed = String(text ?? '').trim();
    if (!trimmed) return null;

    let conversation = await this.findBySessionId(sessionId);
    let created = false;
    if (!conversation) {
      const row = await this.findOrCreateSessionConversation(sessionId, { flowId, flowVersion });
      conversation = row.conversation;
      created = row.created;
    } else if (conversation.status === 'closed') {
      const reopened = await conversationReopenService.reopenFromInboundMessage(conversation, {
        flowId,
      });
      conversation = reopened.conversation;
    }

    const inbound = await this.persistInboundUserMessage(conversation, sessionId, trimmed);
    await this.emitUserInbound(conversation, inbound);

    return { conversation, created, inbound };
  }

  async syncDbSession(conversation, engineResult, flowVersion) {
    let dbSession = await conversationSessionRepository.findActiveByConversationId(
      conversation.id,
    );
    const flowId = engineResult.flowId || conversation.currentFlowId;
    const nodeKey = engineResult.currentNodeId ?? conversation.currentNodeKey;

    if (!dbSession) {
      const created = await conversationService.getOrCreateActiveSession(conversation, {
        flowId,
        flowVersion: flowVersion ?? conversation.currentFlowVersion,
        currentNodeKey: nodeKey,
      });
      dbSession = created.session;
    } else {
      dbSession = await conversationSessionRepository.updateSession(dbSession.id, {
        flowId,
        flowVersion: flowVersion ?? dbSession.flowVersion,
        currentNodeKey: nodeKey,
      });
    }
    return dbSession;
  }

  async notifyWithHandoff(conversation) {
    const handoff = await humanHandoffRepository.findLatestByConversationId(conversation.id);
    notifyConversationUpdated(conversation, {
      humanHandoff: mapHumanHandoffPublic(handoff),
    });
  }

  /**
   * Persiste respuesta del motor (y handoff) después de que el usuario ya fue guardado.
   */
  async persistEngineResponseAfter({
    sessionId,
    engineResult,
    flowId,
    flowVersion = null,
    conversation: initialConversation = null,
    isStart = false,
  }) {
    if (!(await this.ensureReady())) return null;

    const runtimeUserId = simulatorRuntimeUserId(sessionId);
    const memorySession = sessionService.getSession(runtimeUserId);
    const resolvedVersion =
      flowVersion ?? memorySession?.flowVersion ?? null;

    let conversation = initialConversation;
    let created = false;
    if (!conversation) {
      const row = await this.findOrCreateSessionConversation(sessionId, {
        flowId: engineResult?.flowId || flowId,
        flowVersion: resolvedVersion,
      });
      conversation = row.conversation;
      created = row.created;
    }

    const dbSession = await this.syncDbSession(conversation, engineResult, resolvedVersion);

    if (isEngineHumanHandoffResult(engineResult) && !isConversationInHumanMode(conversation)) {
      const handoffResult = await humanHandoffService.processEngineHandoff(
        { conversation, dbSession },
        engineResult,
        { userId: runtimeUserId, flowId: engineResult.flowId || flowId, text: '' },
        { memorySession },
      );
      conversation = handoffResult.conversation;

      if (engineResult.reply?.trim()) {
        const botMsg = await conversationService.persistOutboundBotMessage(
          conversation,
          engineResult.reply,
          {
            generatedBy: 'simulator',
            flowId: engineResult.flowId,
            flowVersion: resolvedVersion,
            nodeKey: engineResult.currentNodeId,
            metadataExtra: { sessionId, event: 'human_handoff' },
          },
        );
        conversation = await conversationService.reloadConversation(conversation);
        notifyConversationMessageCreated(conversation, botMsg, {
          humanHandoff: mapHumanHandoffPublic(handoffResult.handoff),
        });
      } else {
        await this.notifyWithHandoff(conversation);
      }
    } else if (isConversationInHumanMode(conversation)) {
      conversation = await conversationRepository.updateConversation(conversation.id, {
        displayName: displayNameForSimulatorStatus(conversation.status),
        currentNodeKey: engineResult.currentNodeId ?? conversation.currentNodeKey,
        lastMessageAt: new Date(),
      });
      await this.notifyWithHandoff(conversation);
    } else {
      conversation = await conversationRepository.updateConversation(conversation.id, {
        status: 'bot',
        currentFlowId: engineResult.flowId || flowId,
        currentFlowVersion: resolvedVersion,
        currentNodeKey: engineResult.currentNodeId,
        displayName: displayNameForSimulatorStatus('bot'),
        lastMessageAt: new Date(),
      });

      if (engineResult.reply?.trim()) {
        const botMsg = await conversationService.persistOutboundBotMessage(
          conversation,
          engineResult.reply,
          {
            generatedBy: 'simulator',
            flowId: engineResult.flowId,
            flowVersion: resolvedVersion,
            nodeKey: engineResult.currentNodeId,
            metadataExtra: { sessionId },
          },
        );
        conversation = await conversationService.reloadConversation(conversation);
        notifyConversationMessageCreated(conversation, botMsg);
      } else if (!created) {
        notifyConversationUpdated(conversation);
      }
    }

    if (created && isStart && !engineResult.reply?.trim()) {
      notifyConversationUpdated(conversation);
    }

    return { conversationId: conversation.id, created };
  }

  /** @deprecated Usar persistUserInputBeforeEngine + persistEngineResponseAfter */
  async persistSimulatorTurn(params) {
    const { sessionId, userText, engineResult, flowId, flowVersion, isStart } = params;
    if (!isStart && userText?.trim()) {
      await this.persistUserInputBeforeEngine({
        sessionId,
        text: userText,
        flowId,
        flowVersion,
      });
    }
    return this.persistEngineResponseAfter({
      sessionId,
      engineResult,
      flowId,
      flowVersion,
      isStart,
    });
  }

  async persistHumanModeInbound(sessionId, text) {
    if (!(await this.ensureReady())) return null;
    const conversation = await this.findActiveBySessionId(sessionId);
    if (!conversation) return null;

    const inbound = await this.persistInboundUserMessage(conversation, sessionId, text);
    if (!inbound) return null;

    const updated = await conversationRepository.updateConversation(conversation.id, {
      displayName: displayNameForSimulatorStatus(conversation.status),
      lastMessageAt: new Date(),
    });
    notifyConversationMessageCreated(updated, inbound);
    await this.notifyWithHandoff(updated);
    return { conversationId: updated.id };
  }
}

const simulatorPersistenceService = new SimulatorPersistenceService();
export default simulatorPersistenceService;
