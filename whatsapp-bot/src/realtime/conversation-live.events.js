/** @typedef {'conversation.created' | 'conversation.updated' | 'conversation.message.created' | 'conversation.assigned' | 'conversation.closed' | 'conversation.returned_to_bot'} ConversationLiveEventType */

export const CONVERSATION_LIVE_EVENT_TYPES = {
  CREATED: 'conversation.created',
  UPDATED: 'conversation.updated',
  MESSAGE_CREATED: 'conversation.message.created',
  ASSIGNED: 'conversation.assigned',
  CLOSED: 'conversation.closed',
  RETURNED_TO_BOT: 'conversation.returned_to_bot',
};
