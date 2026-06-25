import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import conversationService from './conversation.service.js';
import sessionService from './session.service.js';
import twilioWhatsAppService from './twilio-whatsapp.service.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import {
  mapConversationPublic,
  mapHumanHandoffPublic,
  mapLastMessagePublic,
  mapMessagePublic,
  mapSessionPublic,
} from '../utils/conversation-inbox.mapper.js';
import {
  notifyConversationAssigned,
  notifyConversationMessageCreated,
  notifyConversationReturnedToBot,
  notifyConversationUpdated,
} from '../realtime/conversation-live.notify.js';
import { validateContactName } from '../utils/contact-name.js';
import { CONVERSATION_CHANNELS } from '../constants/conversation-channels.js';

const ALLOWED_STATUS = new Set(['bot', 'waiting_human', 'assigned', 'closed', 'paused']);
const ALLOWED_CHANNEL = new Set(CONVERSATION_CHANNELS);
const ALLOWED_PROVIDER = new Set(['twilio', 'internal']);
const ALLOWED_SORT = new Set([
  'last_message_at_desc',
  'last_message_at_asc',
  'started_at_desc',
]);

const HUMAN_REPLY_STATUSES = new Set(['waiting_human', 'assigned', 'paused']);

function parseListFilters(query = {}) {
  const filters = {
    limit: query.limit,
    offset: query.offset,
    sort: ALLOWED_SORT.has(query.sort) ? query.sort : 'last_message_at_desc',
  };

  if (query.status && ALLOWED_STATUS.has(query.status)) {
    filters.status = query.status;
  }
  if (query.channel && ALLOWED_CHANNEL.has(query.channel)) {
    filters.channel = query.channel;
  }
  if (query.provider && ALLOWED_PROVIDER.has(query.provider)) {
    filters.provider = query.provider;
  }
  if (query.search && String(query.search).trim()) {
    filters.search = String(query.search).trim();
  }

  return filters;
}

function appError(code, message, httpStatus = 400) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.apiError = code;
  err.apiMessage = message;
  return err;
}

export class ConversationInboxService {
  async ensureReady() {
    await ensureConversationDbReady();
  }

  async listInboxConversations(query = {}) {
    await this.ensureReady();
    const filters = parseListFilters(query);

    const [items, total] = await Promise.all([
      conversationRepository.listConversations(filters),
      conversationRepository.countConversations(filters),
    ]);

    const ids = items.map((c) => c.id);
    const [lastMessages, handoffs] = await Promise.all([
      conversationMessageRepository.getLastMessageByConversationIds(ids),
      humanHandoffRepository.listLatestByConversationIds(ids),
    ]);

    const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
    const offset = Math.max(Number(filters.offset) || 0, 0);

    return {
      items: items.map((row) => {
        const lastMsg = lastMessages.get(row.id);
        const handoff = handoffs.get(row.id);
        return {
          ...mapConversationPublic(row),
          lastMessage: mapLastMessagePublic(lastMsg),
          humanHandoff: mapHumanHandoffPublic(handoff),
        };
      }),
      total,
      limit,
      offset,
    };
  }

  async getConversationDetail(conversationId) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const [activeSession, humanHandoff] = await Promise.all([
      conversationSessionRepository.findLatestOpenByConversationId(conversationId),
      humanHandoffRepository.findLatestByConversationId(conversationId),
    ]);

    return {
      conversation: mapConversationPublic(conversation),
      activeSession: mapSessionPublic(activeSession),
      humanHandoff: mapHumanHandoffPublic(humanHandoff),
    };
  }

  async getConversationMessages(conversationId, query = {}) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const order = String(query.order || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';

    const [messages, total] = await Promise.all([
      conversationMessageRepository.listByConversationId(conversationId, { limit, offset, order }),
      conversationMessageRepository.countByConversationId(conversationId),
    ]);

    return {
      items: messages.map((m) => mapMessagePublic(m)),
      total,
      limit,
      offset,
      order,
    };
  }

  async claimConversation(conversationId, agentId) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }
    if (conversation.status === 'closed') {
      throw appError(
        'CONVERSATION_CLOSED',
        'No se puede tomar una conversación cerrada',
        409,
      );
    }
    if (conversation.status === 'bot') {
      throw appError(
        'CONVERSATION_BOT_ACTIVE',
        'El bot está activo en esta conversación. No se puede tomar sin derivación humana.',
        409,
      );
    }
    if (conversation.status === 'assigned' || conversation.status === 'paused') {
      return { conversation: mapConversationPublic(conversation) };
    }
    if (conversation.status !== 'waiting_human') {
      throw appError(
        'INVALID_STATE',
        'Solo se pueden tomar conversaciones en espera de humano',
        409,
      );
    }

    const updated = await this._assignConversationToAgent(conversationId, agentId);
    return { conversation: mapConversationPublic(updated) };
  }

  async _assignConversationToAgent(conversationId, agentId) {
    const updated = await conversationService.markAssigned(conversationId, agentId);
    let handoff = await humanHandoffRepository.findPendingByConversationId(conversationId);
    if (handoff) {
      await humanHandoffRepository.updateHandoff(handoff.id, {
        status: 'assigned',
        assignedAgentId: agentId,
        assignedAt: new Date(),
      });
    } else {
      handoff = await humanHandoffRepository.findLatestByConversationId(conversationId);
      if (handoff && ['pending', 'assigned'].includes(handoff.status)) {
        await humanHandoffRepository.updateHandoff(handoff.id, {
          status: 'assigned',
          assignedAgentId: agentId,
          assignedAt: new Date(),
        });
      }
    }

    notifyConversationAssigned(updated, handoff);
    return updated;
  }

  async sendAgentMessage(conversationId, body, agentId) {
    await this.ensureReady();
    const trimmed = String(body || '').trim();
    if (!trimmed) {
      throw appError('EMPTY_BODY', 'El mensaje no puede estar vacío', 400);
    }

    let conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }
    if (conversation.status === 'closed') {
      throw appError(
        'CONVERSATION_CLOSED',
        'No se puede responder una conversación cerrada',
        409,
      );
    }
    if (conversation.status === 'bot') {
      throw appError(
        'CONVERSATION_BOT_ACTIVE',
        'Para responder, primero tomá la conversación o derivá al equipo humano',
        409,
      );
    }

    if (conversation.status === 'waiting_human') {
      const claimed = await this.claimConversation(conversationId, agentId);
      conversation = await conversationRepository.getConversationById(claimed.conversation.id);
    }

    if (!HUMAN_REPLY_STATUSES.has(conversation.status)) {
      throw appError('INVALID_STATE', 'Estado de conversación no compatible con respuesta manual', 409);
    }

    let providerMessageId = null;
    const isSeedConversation = await this._isSeedConversation(conversation.id);

    if (
      conversation.channel === 'whatsapp'
      && conversation.provider === 'twilio'
      && !isSeedConversation
    ) {
      if (!conversation.phoneNumber) {
        throw appError(
          'MISSING_PHONE',
          'La conversación no tiene número de teléfono para enviar por WhatsApp',
          400,
        );
      }
      try {
        twilioWhatsAppService.assertConfigured();
        const sent = await twilioWhatsAppService.sendWhatsAppMessage({
          to: conversation.phoneNumber,
          body: trimmed,
        });
        providerMessageId = sent.sid;
      } catch (error) {
        if (error.code === 'TWILIO_NOT_CONFIGURED') {
          throw appError(
            'TWILIO_NOT_CONFIGURED',
            'Twilio no está configurado. Verificá TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_WHATSAPP_FROM.',
            503,
          );
        }
        if (error.code === 'TWILIO_SEND_FAILED') {
          throw appError(
            'TWILIO_SEND_FAILED',
            'No se pudo enviar el mensaje por Twilio. Verificá la configuración o intentá nuevamente.',
            502,
          );
        }
        throw error;
      }
    }

    const message = await conversationMessageRepository.createMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      senderType: 'agent',
      body: trimmed,
      provider: conversation.provider,
      providerMessageId,
      metadataJson: {
        generatedBy: 'agent_inbox',
        agentId,
      },
    });

    const updatedConversation = await conversationRepository.updateConversation(conversation.id, {
      status: 'assigned',
      assignedAgentId: agentId,
      lastMessageAt: new Date(),
    });

    const result = {
      message: mapMessagePublic(message),
      conversation: mapConversationPublic(updatedConversation),
    };
    notifyConversationMessageCreated(updatedConversation, message);
    return result;
  }

  async _returnConversationToBot(conversationId, {
    resolutionNote = null,
    systemMessage = 'Conversación cerrada por el equipo. El bot retomará la atención.',
    generatedBy = 'agent_inbox',
  } = {}) {
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    await conversationSessionRepository.endAllActiveForConversation(conversationId);

    if (conversation.externalUserId) {
      await sessionService.resetSession(conversation.externalUserId);
    }

    const handoff =
      (await humanHandoffRepository.findPendingByConversationId(conversationId))
      || (await humanHandoffRepository.findLatestByConversationId(conversationId));
    if (handoff && ['pending', 'assigned'].includes(handoff.status)) {
      await humanHandoffRepository.updateHandoff(handoff.id, {
        status: 'resolved',
        resolvedAt: new Date(),
        resolutionNote: resolutionNote || null,
      });
    }

    const updated = await conversationService.returnConversationToBot(conversationId);

    await conversationMessageRepository.createMessage({
      conversationId,
      direction: 'outbound',
      senderType: 'system',
      body: systemMessage,
      provider: conversation.provider,
      metadataJson: { event: 'conversation_returned_to_bot', generatedBy },
    });

    const result = { conversation: mapConversationPublic(updated) };
    notifyConversationReturnedToBot(updated);
    return result;
  }

  async closeConversation(conversationId, resolutionNote = null) {
    await this.ensureReady();
    return this._returnConversationToBot(conversationId, {
      resolutionNote,
      generatedBy: 'agent_inbox_close',
    });
  }

  async _isSeedConversation(conversationId) {
    const messages = await conversationMessageRepository.listByConversationId(
      conversationId,
      { limit: 1, offset: 0, order: 'asc' },
    );
    if (messages[0]?.metadataJson?.seed === true) return true;
    const conv = await conversationRepository.getConversationById(conversationId);
    return conv?.externalUserId?.startsWith('SIM-') ?? false;
  }

  async updateConversationContact(conversationId, rawName) {
    await this.ensureReady();
    const conversation = await conversationRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const displayName = rawName === null || rawName === undefined
      ? null
      : validateContactName(rawName);

    const updated = await conversationRepository.updateConversation(conversationId, {
      displayName,
    });

    if (displayName && conversation.phoneNumber) {
      await conversationRepository.syncDisplayNameByPhoneAndChannel(
        conversation.phoneNumber,
        conversation.channel,
        displayName,
      );
    }

    notifyConversationUpdated(updated);

    return {
      conversationId: updated.id,
      phone: updated.phoneNumber ?? null,
      contactName: updated.displayName ?? null,
      displayName: updated.displayName ?? null,
      conversation: mapConversationPublic(updated),
    };
  }

  async returnConversationToBot(conversationId) {
    await this.ensureReady();
    return this._returnConversationToBot(conversationId, {
      systemMessage: 'Conversación devuelta al bot.',
      generatedBy: 'agent_inbox_return_to_bot',
    });
  }
}

const conversationInboxService = new ConversationInboxService();
export default conversationInboxService;
export { parseListFilters };
