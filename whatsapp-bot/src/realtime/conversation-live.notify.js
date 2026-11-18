import {
  mapAttachmentPublic,
  mapConversationPublic,
  mapHumanHandoffPublic,
  mapLastMessagePublic,
  mapMessagePublic,
} from '../utils/conversation-inbox.mapper.js';
import { labelForAssignedAgent } from '../utils/agent-identity.js';
import {
  publishConversationAssigned,
  publishConversationClosed,
  publishConversationCreated,
  publishConversationMessageCreated,
  publishConversationMessageUpdated,
  publishConversationReturnedToBot,
  publishConversationUpdated,
} from './conversation-live.broadcaster.js';

function conversationPayload(conversation) {
  const mapped = mapConversationPublic(conversation);
  if (!mapped) return mapped;
  return {
    ...mapped,
    assignedAgentLabel: labelForAssignedAgent(mapped.assignedAgentId),
  };
}

export function notifyConversationCreated(conversation, extras = {}) {
  publishConversationCreated(conversation.id, {
    conversation: conversationPayload(conversation),
    ...extras,
  });
}

export function notifyConversationUpdated(conversation, extras = {}) {
  publishConversationUpdated(conversation.id, {
    conversation: conversationPayload(conversation),
    ...extras,
  });
}

export function notifyConversationMessageCreated(conversation, message, extras = {}) {
  const { attachments: attachmentRows = [], ...safeExtras } = extras;
  const rows = Array.isArray(attachmentRows) ? attachmentRows : [];
  publishConversationMessageCreated(conversation.id, {
    message: mapMessagePublic(message, {
      attachments: rows.map((row) => mapAttachmentPublic(row)).filter(Boolean),
    }),
    lastMessage: mapLastMessagePublic(message),
    conversation: conversationPayload(conversation),
    ...safeExtras,
  });
}

export function notifyConversationMessageUpdated(conversation, message, extras = {}) {
  const {
    attachments: attachmentRows = [],
    whatsappDelivery = undefined,
    ...safeExtras
  } = extras;
  const rows = Array.isArray(attachmentRows) ? attachmentRows : [];
  publishConversationMessageUpdated(conversation.id, {
    message: mapMessagePublic(message, {
      attachments: rows.map((row) => mapAttachmentPublic(row)).filter(Boolean),
      whatsappDelivery,
    }),
    conversation: conversationPayload(conversation),
    ...safeExtras,
  });
}

export function notifyConversationAssigned(conversation, handoff = null) {
  publishConversationAssigned(conversation.id, {
    conversation: conversationPayload(conversation),
    humanHandoff: mapHumanHandoffPublic(handoff),
  });
  publishConversationUpdated(conversation.id, {
    conversation: conversationPayload(conversation),
    humanHandoff: mapHumanHandoffPublic(handoff),
  });
}

export function notifyConversationClosed(conversation) {
  publishConversationClosed(conversation.id, {
    conversation: conversationPayload(conversation),
  });
  publishConversationUpdated(conversation.id, {
    conversation: conversationPayload(conversation),
  });
}

export function notifyConversationReturnedToBot(conversation) {
  publishConversationReturnedToBot(conversation.id, {
    conversation: conversationPayload(conversation),
  });
  publishConversationUpdated(conversation.id, {
    conversation: conversationPayload(conversation),
  });
}
