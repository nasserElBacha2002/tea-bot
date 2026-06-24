import type { ConversationStatus } from '../types/conversation.types';

/** Conversations where an operator may need to act (not fully bot-handled). */
export function conversationRequiresHumanAttention(
  status: ConversationStatus | string | null | undefined,
): boolean {
  const normalized = String(status ?? '').trim();
  return normalized === 'waiting_human' || normalized === 'assigned' || normalized === 'paused';
}
