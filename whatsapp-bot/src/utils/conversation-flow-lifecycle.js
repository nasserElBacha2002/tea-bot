/**
 * Criterio autoritativo: FIRST_CONTACT vs FLOW_NODE_RESPONSE.
 *
 * Una Conversation o ConversationSession puede existir (webhook, persistencia)
 * sin que el bot haya presentado todavía un nodo. currentNodeKey es la señal
 * de que el flujo ya se inicializó frente al usuario.
 *
 * No usar "conversation exists" ni "session row exists" como proxy.
 */

/**
 * @param {{ currentNodeKey?: string | null } | null | undefined} conversation
 * @param {{ currentNodeKey?: string | null } | null | undefined} dbSession
 * @returns {boolean}
 */
export function isFlowPresentedToUser(conversation = null, dbSession = null) {
  const conversationNode = String(conversation?.currentNodeKey || '').trim();
  if (conversationNode) return true;
  const sessionNode = String(dbSession?.currentNodeKey || '').trim();
  return Boolean(sessionNode);
}

/**
 * Hidratar runtime solo si el flujo ya tiene un nodo presentado/persistido.
 * Si currentNodeKey es null en conversación y sesión, el motor debe tratar
 * el mensaje como apertura (FIRST_CONTACT), no como respuesta a un menú.
 *
 * @param {{ currentNodeKey?: string | null } | null | undefined} dbSession
 * @param {{ currentNodeKey?: string | null } | null | undefined} conversation
 * @returns {boolean}
 */
export function shouldHydrateRuntimeSession(dbSession, conversation = null) {
  return isFlowPresentedToUser(conversation, dbSession);
}

/**
 * Nodo desde el cual reanudar. No inventar 'welcome' si no hay nodo persistido.
 *
 * @param {{ currentNodeKey?: string | null } | null | undefined} dbSession
 * @param {{ currentNodeKey?: string | null } | null | undefined} conversation
 * @returns {string | null}
 */
export function resolveHydrationNodeKey(dbSession, conversation = null) {
  const sessionNode = String(dbSession?.currentNodeKey || '').trim();
  if (sessionNode) return sessionNode;
  const conversationNode = String(conversation?.currentNodeKey || '').trim();
  return conversationNode || null;
}
