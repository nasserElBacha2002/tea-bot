const HUMAN_NODE_IDS = new Set([
  'human_handoff',
  'humano',
  'asesor',
  'representante',
]);

const DEFAULT_HANDOFF_MESSAGE =
  'Perfecto. Te vamos a derivar con una persona del equipo. Te van a responder por este mismo chat.';

/**
 * @param {object} engineResult
 * @returns {boolean}
 */
export function isEngineHumanHandoffResult(engineResult) {
  if (!engineResult) return false;
  if (engineResult.requiresHuman === true) return true;
  if (engineResult.terminalReason === 'human_handoff' || engineResult.terminalReason === 'fallback_handoff') {
    return true;
  }
  const nodeId = String(engineResult.currentNodeId || '').trim();
  if (nodeId && HUMAN_NODE_IDS.has(nodeId)) return true;
  return false;
}

/**
 * @param {{ status?: string }} conversation
 */
export function isConversationInHumanMode(conversation) {
  const status = String(conversation?.status || '').trim();
  return status === 'waiting_human' || status === 'assigned';
}

/**
 * @param {string | null | undefined} nodeId
 * @param {string | null | undefined} engineReply
 */
export function resolveHandoffConfirmationMessage(nodeId, engineReply) {
  const reply = String(engineReply || '').trim();
  if (reply) return reply;
  return DEFAULT_HANDOFF_MESSAGE;
}

export { DEFAULT_HANDOFF_MESSAGE, HUMAN_NODE_IDS };
