import type {
  ConversationSearchContactHit,
  ConversationSearchMessageHit,
  InboxConversationItem,
} from '../types/conversation.types';

const FALLBACK_STARTED_AT = '1970-01-01T00:00:00.000Z';

function syntheticInbox(
  conversationId: string,
  phoneNumber: string | null,
  displayName: string | null,
  lastMessageAt: string | null,
  lastMessage: InboxConversationItem['lastMessage'],
): InboxConversationItem {
  return {
    id: conversationId,
    channel: 'simulator',
    provider: 'internal',
    phoneNumber,
    displayName,
    status: 'bot',
    assignedAgentId: null,
    currentFlowId: null,
    currentFlowVersion: null,
    currentNodeKey: null,
    lastMessageAt,
    startedAt: lastMessageAt ?? FALLBACK_STARTED_AT,
    closedAt: null,
    lastMessage,
    humanHandoff: null,
  };
}

function mergeWithInbox(
  base: InboxConversationItem,
  cached?: InboxConversationItem,
): InboxConversationItem {
  if (!cached) return base;
  return {
    ...cached,
    phoneNumber: base.phoneNumber ?? cached.phoneNumber,
    displayName: base.displayName ?? cached.displayName,
    lastMessageAt: base.lastMessageAt ?? cached.lastMessageAt,
    lastMessage: base.lastMessage ?? cached.lastMessage,
  };
}

export function contactHitToInboxItem(
  hit: ConversationSearchContactHit,
  cached?: InboxConversationItem,
): InboxConversationItem {
  const base = syntheticInbox(
    hit.conversationId,
    hit.phoneNumber,
    hit.displayName,
    hit.lastMessageAt,
    null,
  );
  return mergeWithInbox(base, cached);
}

export function messageHitToInboxItem(
  hit: ConversationSearchMessageHit,
  cached?: InboxConversationItem,
): InboxConversationItem {
  const lastMessage = {
    body: hit.snippet,
    direction: hit.direction,
    senderType: hit.senderType,
    createdAt: hit.createdAt,
  };
  const base = syntheticInbox(
    hit.conversationId,
    hit.phoneNumber ?? null,
    hit.displayName,
    hit.createdAt,
    lastMessage,
  );
  return mergeWithInbox(base, cached);
}