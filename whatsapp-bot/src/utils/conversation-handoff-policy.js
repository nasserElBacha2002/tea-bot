import { HUMAN_NODE_IDS } from './handoff-detection.js';

/**
 * Nodos terminales de handoff que no deben persistir como punto de reanudación del bot.
 * @param {string | null | undefined} nodeKey
 */
export function isHandoffTerminalNode(nodeKey) {
  const normalized = String(nodeKey || '').trim();
  return normalized.length > 0 && HUMAN_NODE_IDS.has(normalized);
}

/**
 * Policy única: ¿debe normalizarse una conversación bot con nodo terminal legacy?
 * Requiere snapshot coherente bajo lock (sin handoff activo).
 *
 * @param {{
 *   conversation: object | null | undefined,
 *   activeHandoff: object | null | undefined,
 *   openSession?: object | null,
 * }} input
 */
export function evaluateLegacyNormalizationCandidate({
  conversation,
  activeHandoff,
  openSession = null,
}) {
  if (!conversation || conversation.status !== 'bot') {
    return { shouldNormalize: false, reason: 'not_bot' };
  }
  if (activeHandoff) {
    return { shouldNormalize: false, reason: 'active_handoff' };
  }

  const terminalConversationNode = isHandoffTerminalNode(conversation.currentNodeKey);
  const terminalSessionNode = isHandoffTerminalNode(openSession?.currentNodeKey);
  if (!terminalConversationNode && !terminalSessionNode) {
    return { shouldNormalize: false, reason: 'no_terminal_node' };
  }

  return { shouldNormalize: true, reason: 'legacy_terminal_without_active_handoff' };
}

/**
 * @param {object | null | undefined} conversation
 * @param {object | null | undefined} activeHandoff
 */
export function shouldBlockBotFlow(conversation, activeHandoff = null) {
  const status = String(conversation?.status || '').trim();
  if (status === 'waiting_human' || status === 'assigned') {
    return true;
  }
  return Boolean(activeHandoff);
}

/**
 * @param {object | null | undefined} activeHandoff
 * @returns {'waiting_human' | 'assigned' | 'bot'}
 */
export function resolveReopenStatusFromHandoff(activeHandoff) {
  if (!activeHandoff) {
    return 'bot';
  }
  if (activeHandoff.status === 'assigned') {
    return 'assigned';
  }
  return 'waiting_human';
}
