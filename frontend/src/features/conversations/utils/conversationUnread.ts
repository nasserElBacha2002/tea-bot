import type { ConversationMessage, InboxConversationItem } from '../types/conversation.types';

function sortMessagesChronologically(messages: ConversationMessage[]): ConversationMessage[] {
  return [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function isInboundUserLastMessage(item: InboxConversationItem): boolean {
  const lm = item.lastMessage;
  if (!lm) return false;
  return lm.direction === 'inbound' && lm.senderType === 'user';
}

/** Último mensaje entrante del usuario posterior al instante de lectura. */
export function isInboundUserMessageUnreadSinceRead(
  lastMessage: InboxConversationItem['lastMessage'],
  readAt: string | null,
): boolean {
  if (!lastMessage) return false;
  if (lastMessage.direction !== 'inbound' || lastMessage.senderType !== 'user') return false;
  if (!readAt) return true;
  return new Date(lastMessage.createdAt).getTime() > new Date(readAt).getTime();
}

/** Sin leer por contenido (ignora contadores de sesión WS). */
export function isConversationDerivedUnread(
  item: InboxConversationItem,
  readAt: string | null,
): boolean {
  if (item.status === 'closed') return false;
  return isInboundUserMessageUnreadSinceRead(item.lastMessage, readAt);
}

/** Mensaje que el agente aún no vio (excluye propios envíos). */
export function isMessageUnreadForAgent(
  message: ConversationMessage,
  readAt: string | null,
): boolean {
  if (message.senderType === 'agent') return false;
  if (!readAt) {
    return message.direction === 'inbound' && message.senderType === 'user';
  }
  return new Date(message.createdAt).getTime() > new Date(readAt).getTime();
}

export function findFirstUnreadMessage(
  messages: ConversationMessage[],
  readAt: string | null,
): ConversationMessage | null {
  return (
    sortMessagesChronologically(messages).find((m) => isMessageUnreadForAgent(m, readAt)) ?? null
  );
}

export function hasUnreadMessagesForAgent(
  messages: ConversationMessage[],
  readAt: string | null,
): boolean {
  return findFirstUnreadMessage(messages, readAt) != null;
}

export function getReadThroughAt(messages: ConversationMessage[]): string {
  const sorted = sortMessagesChronologically(messages);
  const last = sorted[sorted.length - 1];
  return last?.createdAt ?? new Date().toISOString();
}

export function conversationMatchesFilters(
  item: InboxConversationItem,
  filters: { status?: string; channel?: string; search?: string },
): boolean {
  if (filters.status && item.status !== filters.status) return false;
  if (filters.channel && item.channel !== filters.channel) return false;
  if (filters.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    const hay = `${item.displayName ?? ''} ${item.phoneNumber ?? ''} ${item.lastMessage?.body ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function listPriorityAccent(status: string, unread: boolean): 'high' | 'medium' | 'none' {
  if (status === 'closed') return 'none';
  if (status === 'waiting_human' && unread) return 'high';
  if (status === 'assigned' && unread) return 'high';
  if (unread) return 'medium';
  return 'none';
}
