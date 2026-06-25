import type { ConversationStatus } from '../types/conversation.types';

export function normalizeAgentId(agentId: string | null | undefined): string | null {
  if (agentId == null) return null;
  const trimmed = String(agentId).trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function isSameAgentId(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeAgentId(left);
  const b = normalizeAgentId(right);
  return Boolean(a && b && a === b);
}

/** Estados donde cualquier operador autenticado puede responder. */
export function canOperatorReply(status: ConversationStatus): boolean {
  return status === 'waiting_human' || status === 'assigned' || status === 'paused';
}
