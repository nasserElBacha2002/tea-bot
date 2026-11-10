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

function sameAgent(left?: string | null, right?: string | null) {
  const a = left?.trim().toLowerCase();
  const b = right?.trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function liveAttentionPatch(
  existing: {
    canTakeover?: boolean;
    canReturnToBot?: boolean;
    canForceReturn?: boolean;
    assignedAgentId?: string | null;
    assignedAgentLabel?: string | null;
    takeoverBlock?: string | null;
  } | undefined,
  conv: Pick<
    InboxConversationItem,
    'status' | 'canTakeover' | 'canReturnToBot' | 'canForceReturn' | 'botPaused' | 'assignedAgentLabel' | 'assignedAgentId' | 'statusVersion' | 'takeoverBlock'
  >,
  viewerAgentId?: string | null,
): Partial<InboxConversationItem> {
  const patch: Partial<InboxConversationItem> = {};
  if (conv.canTakeover != null) patch.canTakeover = conv.canTakeover;
  else if (
    existing?.canTakeover
    && (conv.status === 'assigned' || conv.status === 'closed' || conv.status === 'paused')
  ) {
    patch.canTakeover = false;
  }
  if (
    (conv.status === 'assigned' || conv.status === 'paused')
    && conv.takeoverBlock == null
  ) {
    patch.canTakeover = false;
    if (existing?.takeoverBlock === 'disabled') {
      patch.takeoverBlock = 'disabled';
    } else if (sameAgent(viewerAgentId, conv.assignedAgentId)) {
      patch.takeoverBlock = 'already_owner';
    } else if (viewerAgentId && conv.assignedAgentId) {
      patch.takeoverBlock = 'owned_by_other';
    } else {
      patch.takeoverBlock = existing?.canTakeover ? 'owned_by_other' : existing?.takeoverBlock;
    }
  }
  if (conv.botPaused != null) patch.botPaused = conv.botPaused;
  else if (patch.canTakeover === false && conv.status !== 'closed') patch.botPaused = true;
  const assigneeChanged = Boolean(
    conv.assignedAgentId
    && existing?.assignedAgentId
    && !sameAgent(conv.assignedAgentId, existing.assignedAgentId),
  );
  const sharedInbox = existing?.takeoverBlock === 'disabled' || conv.takeoverBlock === 'disabled';
  if (conv.canReturnToBot != null) patch.canReturnToBot = conv.canReturnToBot;
  else if (conv.status === 'bot' || conv.status === 'closed') patch.canReturnToBot = false;
  else if (!sharedInbox && (conv.status === 'assigned' || conv.status === 'paused' || conv.status === 'waiting_human')) {
    patch.canReturnToBot = false;
  }
  if (conv.canForceReturn != null) patch.canForceReturn = conv.canForceReturn;
  else if (!sharedInbox) patch.canForceReturn = false;
  if (conv.assignedAgentLabel != null && !assigneeChanged) {
    patch.assignedAgentLabel = conv.assignedAgentLabel;
  } else if (assigneeChanged) {
    patch.assignedAgentLabel = conv.assignedAgentLabel ?? null;
  }
  if (conv.statusVersion != null) patch.statusVersion = conv.statusVersion;
  if (conv.takeoverBlock != null) patch.takeoverBlock = conv.takeoverBlock;
  return patch;
}

export function liveEventNeedsDetailRefresh(
  conv: Pick<InboxConversationItem, 'status' | 'takeoverBlock' | 'assignedAgentLabel' | 'canReturnToBot' | 'canForceReturn'> | undefined,
): boolean {
  if (!conv) return false;
  if (conv.status !== 'assigned' && conv.status !== 'paused' && conv.status !== 'waiting_human') return false;
  return conv.takeoverBlock == null
    || conv.assignedAgentLabel == null
    || conv.canReturnToBot == null
    || conv.canForceReturn == null;
}

function mergeInboxListItem(
  existing: InboxConversationItem | undefined,
  conv: InboxConversationItem,
  lastMessage: InboxConversationItem['lastMessage'] | undefined,
  humanHandoff: InboxConversationItem['humanHandoff'] | undefined,
  viewerAgentId?: string | null,
): InboxConversationItem {
  return {
    ...(existing ?? {}),
    ...conv,
    id: conv.id,
    displayName: conv.displayName ?? existing?.displayName ?? null,
    contactEmail: conv.contactEmail ?? existing?.contactEmail ?? null,
    lastMessage: lastMessage ?? conv.lastMessage ?? existing?.lastMessage ?? null,
    humanHandoff: humanHandoff ?? conv.humanHandoff ?? existing?.humanHandoff ?? null,
    ...liveAttentionPatch(existing, conv, viewerAgentId),
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
  viewerAgentId: string | null = null,
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
      const listItem = mergeInboxListItem(existing, conv, lastMessage, humanHandoff, viewerAgentId);
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
          displayName: conv.displayName ?? prevDetail.conversation.displayName,
          assignedAgentId:
            conv.assignedAgentId !== undefined
              ? conv.assignedAgentId
              : prevDetail.conversation.assignedAgentId,
          ...liveAttentionPatch(prevDetail.conversation, conv, viewerAgentId),
        },
        humanHandoff: humanHandoff ?? prevDetail.humanHandoff,
      });
    } else if (selectedId === event.conversationId && isWaitingHumanHandoff(conv)) {
      void queryClient.invalidateQueries({ queryKey: detailKey });
    }

    if (liveEventNeedsDetailRefresh(conv)) {
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
