import type { ConversationMessage } from '../types/conversation.types';

export type MessageBubbleRole = 'user' | 'bot' | 'agent' | 'system' | 'unknown';

/** Normaliza rol visual; no filtra mensajes con body. */
export function resolveMessageBubbleRole(msg: ConversationMessage): MessageBubbleRole {
  const sender = String(msg.senderType ?? '').toLowerCase();
  const direction = String(msg.direction ?? '').toLowerCase();

  if (direction === 'inbound') return 'user';

  if (sender === 'user' || sender === 'customer') return 'user';
  if (sender === 'bot') return 'bot';
  if (sender === 'agent' || sender === 'operator') return 'agent';
  if (sender === 'system') return 'system';
  if (direction === 'outbound') return 'bot';

  return 'unknown';
}

export function isInboundUserMessage(msg: ConversationMessage): boolean {
  return resolveMessageBubbleRole(msg) === 'user';
}

export function messageDisplayBody(msg: ConversationMessage): string {
  const body = msg.body?.trim();
  if (body) return body;
  return '—';
}
