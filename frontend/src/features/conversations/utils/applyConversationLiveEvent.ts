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
  if (idx >= 0) next[idx] = item;
  else next.unshift(item);
  next.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });
  return next;
}

function mergeInboxListItem(
  existing: InboxConversationItem | undefined,
  conv: InboxConversationItem,
  lastMessage: InboxConversationItem['lastMessage'] | undefined,
  humanHandoff: InboxConversationItem['humanHandoff'] | undefined,
): InboxConversationItem {
  return {
    ...(existing ?? {}),
    ...conv,
    id: conv.id,
    lastMessage: lastMessage ?? conv.lastMessage ?? existing?.lastMessage ?? null,
    humanHandoff: humanHandoff ?? conv.humanHandoff ?? existing?.humanHandoff ?? null,
  };
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

function isWaitingHumanHandoff(conv: InboxConversationItem | undefined): boolean {
  return conv?.status === 'waiting_human';
}

export function applyConversationLiveEvent(
  queryClient: QueryClient,
  event: ConversationLiveEvent,
  selectedId: string | null,
): {
  unreadConversationId?: string;
  newConversationId?: string;
  handoffConversationId?: string;
} {
  const result: {
    unreadConversationId?: string;
    newConversationId?: string;
    handoffConversationId?: string;
  } = {};
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
  const humanHandoff = event.data?.humanHandoff ?? conv?.humanHandoff ?? undefined;

  if (
    (event.type === 'conversation.updated' || event.type === 'conversation.assigned')
    && event.conversationId
    && !conv
  ) {
    queryClient.invalidateQueries({ queryKey: conversationKeys.all });
  }

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
    patchListQueries(queryClient, (data) => {
      const existing = data.items.find((i) => i.id === conv.id);
      const listItem = mergeInboxListItem(existing, conv, lastMessage, humanHandoff);
      return {
        ...data,
        items: upsertListItem(data.items, listItem),
        total: Math.max(
          data.total,
          data.items.some((i) => i.id === listItem.id) ? data.total : data.total + 1,
        ),
      };
    });

    const detailKey = conversationKeys.detail(event.conversationId);
    const prevDetail = queryClient.getQueryData<ConversationDetailResponse>(detailKey);
    if (prevDetail) {
      queryClient.setQueryData(detailKey, {
        ...prevDetail,
        conversation: {
          ...prevDetail.conversation,
          ...conv,
          assignedAgentId:
            conv.assignedAgentId !== undefined
              ? conv.assignedAgentId
              : prevDetail.conversation.assignedAgentId,
        },
        humanHandoff: humanHandoff ?? prevDetail.humanHandoff,
      });
    } else if (selectedId === event.conversationId && isWaitingHumanHandoff(conv)) {
      void queryClient.invalidateQueries({ queryKey: detailKey });
    }

    if (isWaitingHumanHandoff(conv) && selectedId !== event.conversationId) {
      result.handoffConversationId = event.conversationId;
      result.unreadConversationId = event.conversationId;
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
