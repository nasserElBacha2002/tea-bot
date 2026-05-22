import type { InboxConversationItem } from '../types/conversation.types';

export function isInboundUserLastMessage(item: InboxConversationItem): boolean {
  const lm = item.lastMessage;
  if (!lm) return false;
  return lm.direction === 'inbound' && lm.senderType === 'user';
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
