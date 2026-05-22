import {
  mapConversationPublic,
  mapHumanHandoffPublic,
  mapLastMessagePublic,
  mapMessagePublic,
} from '../utils/conversation-inbox.mapper.js';
import {
  publishConversationAssigned,
  publishConversationClosed,
  publishConversationCreated,
  publishConversationMessageCreated,
  publishConversationReturnedToBot,
  publishConversationUpdated,
} from './conversation-live.broadcaster.js';

export function notifyConversationCreated(conversation, extras = {}) {
  publishConversationCreated(conversation.id, {
    conversation: mapConversationPublic(conversation),
    ...extras,
  });
}

export function notifyConversationUpdated(conversation, extras = {}) {
  publishConversationUpdated(conversation.id, {
    conversation: mapConversationPublic(conversation),
    ...extras,
  });
}

export function notifyConversationMessageCreated(conversation, message, extras = {}) {
  publishConversationMessageCreated(conversation.id, {
    message: mapMessagePublic(message),
    lastMessage: mapLastMessagePublic(message),
    conversation: mapConversationPublic(conversation),
    ...extras,
  });
}

export function notifyConversationAssigned(conversation, handoff = null) {
  publishConversationAssigned(conversation.id, {
    conversation: mapConversationPublic(conversation),
    humanHandoff: mapHumanHandoffPublic(handoff),
  });
  publishConversationUpdated(conversation.id, {
    conversation: mapConversationPublic(conversation),
    humanHandoff: mapHumanHandoffPublic(handoff),
  });
}

export function notifyConversationClosed(conversation) {
  publishConversationClosed(conversation.id, {
    conversation: mapConversationPublic(conversation),
  });
  publishConversationUpdated(conversation.id, {
    conversation: mapConversationPublic(conversation),
  });
}

export function notifyConversationReturnedToBot(conversation) {
  publishConversationReturnedToBot(conversation.id, {
    conversation: mapConversationPublic(conversation),
  });
  publishConversationUpdated(conversation.id, {
    conversation: mapConversationPublic(conversation),
  });
}
