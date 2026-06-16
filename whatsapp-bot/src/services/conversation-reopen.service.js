import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import auditLogService from './audit-log.service.js';
import { notifyConversationUpdated } from '../realtime/conversation-live.notify.js';
import { mapHumanHandoffPublic } from '../utils/conversation-inbox.mapper.js';

/**
 * Reapertura automática al recibir un mensaje entrante en conversación cerrada.
 * Independiente de la acción manual "devolver al bot".
 */
export class ConversationReopenService {
  /**
   * @param {{
   *   conversationRepo?: typeof conversationRepository,
   *   sessionRepo?: typeof conversationSessionRepository,
   *   handoffRepo?: typeof humanHandoffRepository,
   *   audit?: typeof auditLogService,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
    this.handoffRepo = deps.handoffRepo || humanHandoffRepository;
    this.audit = deps.audit || auditLogService;
  }

  /**
   * @param {object} conversation
   * @returns {Promise<'waiting_human' | 'bot'>}
   */
  async resolveReopenStatus(conversation) {
    const latestHandoff = await this.handoffRepo.findLatestByConversationId(conversation.id);
    if (latestHandoff) {
      return 'waiting_human';
    }
    return 'bot';
  }

  /**
   * @param {object} conversation
   * @param {{ flowId?: string | null }} [_context]
   * @returns {Promise<{ conversation: object, reopened: boolean, handoff?: object | null }>}
   */
  async reopenFromInboundMessage(conversation, _context = {}) {
    if (!conversation || conversation.status !== 'closed') {
      return { conversation, reopened: false };
    }

    const previousStatus = conversation.status;
    const newStatus = await this.resolveReopenStatus(conversation);

    await this.sessionRepo.endAllActiveForConversation(conversation.id);

    const patch = {
      status: newStatus,
      closedAt: null,
      assignedAgentId: null,
    };

    let handoff = null;
    if (newStatus === 'waiting_human') {
      const existingPending = await this.handoffRepo.findPendingByConversationId(conversation.id);
      if (existingPending) {
        handoff = existingPending;
      } else {
        handoff = await this.handoffRepo.createHandoff({
          conversationId: conversation.id,
          requestedBy: 'system',
          reason: 'conversation_reopened',
          status: 'pending',
        });
      }
    }

    const updated = await this.conversationRepo.updateConversation(conversation.id, patch);

    await this.audit.record({
      entityType: 'conversation',
      entityId: conversation.id,
      action: 'conversation.reopened',
      beforeJson: {
        status: previousStatus,
        closedAt: conversation.closedAt ?? null,
      },
      afterJson: {
        status: newStatus,
        closedAt: null,
      },
      metadata: {
        reason: 'new_inbound_message',
        previousStatus,
        newStatus,
      },
    });

    const notifyExtras = {};
    if (handoff) {
      notifyExtras.humanHandoff = mapHumanHandoffPublic(handoff);
    }
    notifyConversationUpdated(updated, notifyExtras);

    return { conversation: updated, reopened: true, handoff };
  }
}

const conversationReopenService = new ConversationReopenService();
export default conversationReopenService;
