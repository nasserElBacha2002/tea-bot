import type { ConversationLiveEvent } from '../types/conversationLive.types';
import type { ConversationMessage } from '../types/conversation.types';
import { isInboundUserMessage } from './conversationMessageDisplay';
import { conversationRequiresHumanAttention } from './conversationRequiresHumanAttention';

export interface ConversationAlertUserContext {
  currentAgentId: string | null;
  operatorUsername?: string | null;
}

function isClosedConversation(event: ConversationLiveEvent): boolean {
  const status = event.data?.conversation?.status;
  if (status === 'closed') return true;
  return event.type === 'conversation.closed';
}

function isBotOnlyConversation(event: ConversationLiveEvent): boolean {
  const status = event.data?.conversation?.status;
  return status === 'bot' || event.type === 'conversation.returned_to_bot';
}

function isOperatorOwnOutboundMessage(
  message: ConversationMessage,
  ctx: ConversationAlertUserContext,
): boolean {
  if (message.direction !== 'outbound') return false;
  const sender = String(message.senderType ?? '').toLowerCase();
  if (sender !== 'agent' && sender !== 'operator') return false;
  const meta = message.metadata as Record<string, unknown> | null | undefined;
  const metaAgentId =
    typeof meta?.agentId === 'string'
      ? meta.agentId
      : typeof meta?.assignedAgentId === 'string'
        ? meta.assignedAgentId
        : null;
  if (ctx.currentAgentId && metaAgentId && metaAgentId === ctx.currentAgentId) return true;
  const metaUsername = typeof meta?.username === 'string' ? meta.username : null;
  if (ctx.operatorUsername && metaUsername && metaUsername === ctx.operatorUsername) return true;
  return false;
}

function isAlertableInboundMessage(
  message: ConversationMessage,
  ctx: ConversationAlertUserContext,
): boolean {
  if (!isInboundUserMessage(message)) return false;
  if (isOperatorOwnOutboundMessage(message, ctx)) return false;
  return true;
}

function isHandoffAvailableEvent(event: ConversationLiveEvent): boolean {
  if (event.type !== 'conversation.updated' && event.type !== 'conversation.assigned') {
    return false;
  }
  return event.data?.conversation?.status === 'waiting_human';
}

/** Stable id for deduplicating alert triggers across reconnects or duplicate broadcasts. */
export function buildConversationAlertEventId(event: ConversationLiveEvent): string | null {
  const messageId = event.data?.message?.id;
  if (messageId) return `message:${messageId}`;

  const handoffId = event.data?.humanHandoff?.id ?? event.data?.conversation?.humanHandoff?.id;
  if (handoffId && isHandoffAvailableEvent(event)) {
    return `handoff:${handoffId}`;
  }

  if (isHandoffAvailableEvent(event) && event.conversationId) {
    return `handoff:${event.conversationId}:${event.occurredAt}`;
  }

  if (event.type === 'conversation.created' && event.conversationId) {
    return `created:${event.conversationId}:${event.occurredAt}`;
  }

  return null;
}

/**
 * Returns true when a live event represents a new inbound customer message or a
 * conversation that became available for human operators.
 */
export function shouldPlayConversationAlert(
  event: ConversationLiveEvent,
  ctx: ConversationAlertUserContext,
): boolean {
  if (event.type === 'connected') return false;
  if (isClosedConversation(event)) return false;
  if (isBotOnlyConversation(event)) return false;

  const conversation = event.data?.conversation;
  const status = conversation?.status;
  if (status === 'closed' || status === 'bot') return false;

  const message = event.data?.message;
  if (message) {
    if (!isAlertableInboundMessage(message, ctx)) return false;
    if (!conversationRequiresHumanAttention(status)) return false;
    return true;
  }

  if (isHandoffAvailableEvent(event)) {
    return true;
  }

  if (event.type === 'conversation.created' && conversation) {
    if (!conversationRequiresHumanAttention(conversation.status)) return false;
    const last = event.data?.lastMessage;
    if (last) {
      const pseudoMessage: ConversationMessage = {
        id: 'last',
        conversationId: conversation.id,
        direction: last.direction,
        senderType: last.senderType,
        body: last.body,
        provider: conversation.provider,
        providerMessageId: null,
        metadata: null,
        createdAt: last.createdAt,
      };
      return isAlertableInboundMessage(pseudoMessage, ctx);
    }
    return conversation.status === 'waiting_human';
  }

  return false;
}
