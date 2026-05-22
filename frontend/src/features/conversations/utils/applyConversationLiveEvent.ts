import type { QueryClient } from '@tanstack/react-query';
import type {
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationMessage,
  ConversationMessagesResponse,
  InboxConversationItem,
} from '../types/conversation.types';
import type { ConversationLiveEvent } from '../types/conversationLive.types';
import { conversationKeys } from '../hooks/useConversations';
import { isInboundUserMessage } from './conversationMessageDisplay';

function upsertListItem(
  items: InboxConversationItem[],
  item: InboxConversationItem,
): InboxConversationItem[] {
  const idx = items.findIndex((c) => c.id === item.id);
  const next = [...items];
  if (idx >= 0) next[idx] = { ...next[idx], ...item };
  else next.unshift(item);
  next.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });
  return next;
}

function patchListQueries(
  queryClient: QueryClient,
  updater: (data: ConversationListResponse) => ConversationListResponse,
) {
  const entries = queryClient.getQueriesData<ConversationListResponse>({
    queryKey: conversationKeys.all,
  });
  for (const [key, data] of entries) {
    if (!data || !Array.isArray(key) || key[1] !== 'list') continue;
    queryClient.setQueryData(key, updater(data));
  }
}

export function applyConversationLiveEvent(
  queryClient: QueryClient,
  event: ConversationLiveEvent,
  selectedId: string | null,
): { unreadConversationId?: string; newConversationId?: string } {
  const result: { unreadConversationId?: string; newConversationId?: string } = {};
  const conv = event.data?.conversation;
  const message = event.data?.message;
  const lastMessage = event.data?.lastMessage ?? (message
    ? {
        body: message.body,
        direction: message.direction,
        senderType: message.senderType,
        createdAt: message.createdAt,
      }
    : undefined);

  if (event.type === 'conversation.created' && event.conversationId) {
    if (!conv) {
      queryClient.invalidateQueries({ queryKey: conversationKeys.all });
    }
    if (selectedId !== event.conversationId) {
      result.newConversationId = event.conversationId;
      if (message && isInboundUserMessage(message)) {
        result.unreadConversationId = event.conversationId;
      }
    }
  }

  if (conv && event.conversationId) {
    const listItem: InboxConversationItem = {
      ...conv,
      lastMessage: lastMessage ?? conv.lastMessage ?? null,
      humanHandoff: event.data?.humanHandoff ?? conv.humanHandoff ?? null,
    };

    patchListQueries(queryClient, (data) => ({
      ...data,
      items: upsertListItem(data.items, listItem),
      total: Math.max(data.total, data.items.some((i) => i.id === listItem.id) ? data.total : data.total + 1),
    }));

    const detailKey = conversationKeys.detail(event.conversationId);
    const prevDetail = queryClient.getQueryData<ConversationDetailResponse>(detailKey);
    if (prevDetail) {
      queryClient.setQueryData(detailKey, {
        ...prevDetail,
        conversation: { ...prevDetail.conversation, ...conv },
        humanHandoff: event.data?.humanHandoff ?? prevDetail.humanHandoff,
      });
    }
  }

  if (message && event.conversationId && !conv) {
    queryClient.invalidateQueries({ queryKey: conversationKeys.all });
  }

  if (message && event.conversationId) {
    const userInbound = isInboundUserMessage(message);
    if (selectedId !== event.conversationId && userInbound) {
      result.unreadConversationId = event.conversationId;
    }

    if (selectedId === event.conversationId) {
      const msgKey = conversationKeys.messages(event.conversationId);
      const prev = queryClient.getQueryData<ConversationMessagesResponse>(msgKey);
      if (prev) {
        const exists = prev.items.some((m) => m.id === message.id);
        if (!exists) {
          queryClient.setQueryData(msgKey, {
            ...prev,
            items: [...prev.items, message],
            total: prev.total + 1,
          });
        }
      }
    }
  }

  return result;
}

export function appendMessageIfNew(
  items: ConversationMessage[],
  message: ConversationMessage,
): ConversationMessage[] {
  if (items.some((m) => m.id === message.id)) return items;
  return [...items, message];
}
