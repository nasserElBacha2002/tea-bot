import type { ConversationMessage, InboxConversationItem } from './conversation.types';

export type ConversationLiveEventType =
  | 'connected'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.message.created'
  | 'conversation.assigned'
  | 'conversation.closed'
  | 'conversation.returned_to_bot';

export interface ConversationLiveEvent {
  type: ConversationLiveEventType;
  conversationId?: string;
  occurredAt: string;
  data?: {
    conversation?: InboxConversationItem;
    message?: ConversationMessage;
    lastMessage?: InboxConversationItem['lastMessage'];
    humanHandoff?: InboxConversationItem['humanHandoff'];
    username?: string;
  };
}
