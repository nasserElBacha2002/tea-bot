import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import * as repository from '../monitoring/monitoring.repository.js';
import { noteActivity } from '../monitoring/activity-store.js';
import { isExactDeliveryStatusDuplicate } from '../monitoring/rules.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import {
  mapMessagePublic,
  mapWhatsappDeliveryPublic,
} from '../utils/conversation-inbox.mapper.js';
import { notifyConversationMessageUpdated } from '../realtime/conversation-live.notify.js';

export const deliveryDeps = {
  repository,
  conversationMessageRepository,
  conversationRepository,
  attachmentRepository,
  notifyConversationMessageUpdated,
};

const PROVIDER = 'twilio';

function parseCallback(body = {}) {
  const providerMessageId = body?.MessageSid || body?.SmsSid || null;
  const status = body?.MessageStatus || body?.SmsStatus || null;
  if (!providerMessageId || !status) return null;
  return {
    providerMessageId: String(providerMessageId).slice(0, 128),
    status: String(status).toLowerCase(),
    errorCode: body?.ErrorCode ? String(body.ErrorCode).slice(0, 64) : null,
    errorMessage: body?.ErrorMessage ? String(body.ErrorMessage).slice(0, 400) : null,
    statusAt: new Date(),
  };
}

export async function buildDeliveryStatusMapForMessages(messages = []) {
  const sids = messages
    .filter((message) => message?.direction === 'outbound' && message.providerMessageId)
    .map((message) => message.providerMessageId);
  return deliveryDeps.repository.listDeliveryStatusRows(PROVIDER, sids);
}

async function publishLinkedOutboundDelivery(providerMessageId) {
  const message = await deliveryDeps.conversationMessageRepository.findByProviderMessageId(
    PROVIDER,
    providerMessageId,
  );
  if (!message || message.direction !== 'outbound' || !message.providerMessageId) {
    return { notified: false, reason: 'message_not_linked' };
  }
  const [conversation, attachments, deliveryRow] = await Promise.all([
    deliveryDeps.conversationRepository.getConversationById(message.conversationId),
    deliveryDeps.attachmentRepository.findByMessageId(message.id),
    deliveryDeps.repository.getDeliveryStatusRow(PROVIDER, providerMessageId),
  ]);
  if (!conversation) return { notified: false, reason: 'conversation_missing' };
  deliveryDeps.notifyConversationMessageUpdated(conversation, message, {
    attachments,
    whatsappDelivery: mapWhatsappDeliveryPublic(deliveryRow),
  });
  return { notified: true, messageId: message.id, conversationId: message.conversationId };
}

export async function notifyLinkedOutboundDelivery(providerMessageId) {
  try {
    return await publishLinkedOutboundDelivery(providerMessageId);
  } catch (error) {
    return {
      notified: false,
      reason: 'notify_failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function safeNotifyLinkedOutboundDelivery(providerMessageId) {
  return notifyLinkedOutboundDelivery(providerMessageId);
}

export async function syncDeliveryAfterOutboundLink(message) {
  if (!message?.providerMessageId || message.direction !== 'outbound') {
    return { applied: false };
  }
  const deliveryRow = await deliveryDeps.repository.getDeliveryStatusRow(PROVIDER, message.providerMessageId);
  if (!deliveryRow) return { applied: false, reason: 'no_delivery_row' };
  return notifyLinkedOutboundDelivery(message.providerMessageId);
}

export async function processStatusCallback(body = {}) {
  if (!isConversationDbEnabled()) return { applied: false, reason: 'db_disabled' };
  const parsed = parseCallback(body);
  if (!parsed) return { applied: false, reason: 'invalid_payload' };

  const advance = await deliveryDeps.repository.applyDeliveryStatusAdvance({
    provider: PROVIDER,
    providerMessageId: parsed.providerMessageId,
    status: parsed.status,
    errorCode: parsed.errorCode,
    errorMessage: parsed.errorMessage,
    statusAt: parsed.statusAt,
  });
  if (!advance.applied) {
    let notifyResult = { notified: false };
    if (isExactDeliveryStatusDuplicate(advance.previous, parsed.status)) {
      notifyResult = await safeNotifyLinkedOutboundDelivery(parsed.providerMessageId);
    }
    return {
      applied: false,
      previous: advance.previous,
      reason: advance.reason || 'stale_or_duplicate',
      notified: notifyResult.notified,
      notifyRecovered: Boolean(notifyResult.notified),
      messageId: notifyResult.messageId || null,
    };
  }

  if (
    config.monitoringEnabled
    && (parsed.status === 'failed' || parsed.status === 'undelivered')
  ) {
    noteActivity('lastErrorAt', parsed.errorCode || parsed.status);
  }

  const notifyResult = await safeNotifyLinkedOutboundDelivery(parsed.providerMessageId);
  return {
    applied: true,
    previous: advance.previous,
    notified: notifyResult.notified,
    notifyRecovered: false,
    messageId: notifyResult.messageId || null,
  };
}

export function mapMessagesPublicWithDelivery(messages, attachmentMap, deliveryMap) {
  return messages.map((message) => {
    const deliveryRow = message.providerMessageId
      ? deliveryMap.get(message.providerMessageId) || null
      : null;
    return mapMessagePublic(message, {
      attachments: attachmentMap.get(message.id) || [],
      whatsappDelivery: mapWhatsappDeliveryPublic(deliveryRow),
    });
  });
}

const twilioMessageDeliveryService = {
  processStatusCallback,
  notifyLinkedOutboundDelivery,
  syncDeliveryAfterOutboundLink,
  buildDeliveryStatusMapForMessages,
  mapMessagesPublicWithDelivery,
};

export default twilioMessageDeliveryService;