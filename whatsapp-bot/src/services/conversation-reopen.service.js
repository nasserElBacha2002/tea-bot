import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import auditLogService from './audit-log.service.js';
import { withTransaction } from '../db/index.js';
import { fenceInboundLease } from '../monitoring/inbound-lease.js';
import { notifyConversationUpdated } from '../realtime/conversation-live.notify.js';
import { mapHumanHandoffPublic } from '../utils/conversation-inbox.mapper.js';
import { resolveReopenStatusFromHandoff } from '../utils/conversation-handoff-policy.js';

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
   *   runTransaction?: typeof withTransaction,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
    this.handoffRepo = deps.handoffRepo || humanHandoffRepository;
    this.audit = deps.audit || auditLogService;
    this.runTransaction = deps.runTransaction || withTransaction;
  }

  /**
   * @param {object} conversation
   * @returns {Promise<{ conversation: object, reopened: boolean, handoff?: object | null }>}
   */
  async reopenFromInboundMessage(conversation, context = {}) {
    if (!conversation || conversation.status !== 'closed') {
      return { conversation, reopened: false };
    }

    const previousStatus = conversation.status;

    const txResult = await this.runTransaction(async (transaction) => {
      await fenceInboundLease(transaction);
      await this.conversationRepo.findByIdForUpdate(conversation.id, { transaction });

      const activeHandoffs = await this.handoffRepo.findActiveByConversationIdForUpdate(
        conversation.id,
        { transaction },
      );
      const activeHandoff = activeHandoffs[0] || null;
      const newStatus = resolveReopenStatusFromHandoff(activeHandoff);

      await this.sessionRepo.endAllOpenForConversation(conversation.id, new Date(), {
        transaction,
      });

      const patch = {
        status: newStatus,
        closedAt: null,
        assignedAgentId: null,
      };

      if (newStatus === 'assigned' && activeHandoff?.assignedAgentId) {
        patch.assignedAgentId = activeHandoff.assignedAgentId;
      }

      const updated = await this.conversationRepo.updateConversation(
        conversation.id,
        patch,
        { transaction },
      );

      return {
        conversation: updated,
        activeHandoff,
        newStatus,
      };
    });

    await this.audit.record({
      entityType: 'conversation',
      entityId: conversation.id,
      action: 'conversation.reopened',
      beforeJson: {
        status: previousStatus,
        closedAt: conversation.closedAt ?? null,
      },
      afterJson: {
        status: txResult.newStatus,
        closedAt: null,
      },
      metadata: {
        reason: 'new_inbound_message',
        previousStatus,
        newStatus: txResult.newStatus,
        providerMessageId: context.providerMessageId || null,
      },
    });

    const notifyExtras = {};
    const handoff =
      txResult.newStatus === 'waiting_human' && txResult.activeHandoff?.status === 'pending'
        ? txResult.activeHandoff
        : null;
    if (handoff) {
      notifyExtras.humanHandoff = mapHumanHandoffPublic(handoff);
    }
    notifyConversationUpdated(txResult.conversation, notifyExtras);

    return {
      conversation: txResult.conversation,
      reopened: true,
      handoff,
    };
  }
}

const conversationReopenService = new ConversationReopenService();
export default conversationReopenService;
