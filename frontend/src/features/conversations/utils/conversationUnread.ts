import type { InboxConversationItem } from '../types/conversation.types';

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
