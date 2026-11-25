import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import classificationReconciliationService from './conversationClassification/classificationReconciliation.service.js';

function asStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function isOrderedSubsequence(sub, full) {
  const subList = asStringArray(sub);
  const fullList = asStringArray(full);
  if (subList.length === 0) return true;
  if (fullList.length < subList.length) return false;
  let cursor = 0;
  for (const node of fullList) {
    if (node === subList[cursor]) cursor += 1;
    if (cursor === subList.length) return true;
  }
  return cursor === subList.length;
}

function mergeVisitedNodes(runtimeNodes, persistedNodes) {
  const runtime = asStringArray(runtimeNodes);
  const persisted = asStringArray(persistedNodes);
  if (persisted.length === 0) return runtime;
  if (runtime.length === 0) return persisted;
  if (isOrderedSubsequence(runtime, persisted)) return persisted;
  if (isOrderedSubsequence(persisted, runtime)) return runtime;
  return runtime;
}

function mergeAnswers(runtimeAnswers, persistedAnswers, { preferPersisted = false } = {}) {
  const left = runtimeAnswers && typeof runtimeAnswers === 'object' ? runtimeAnswers : {};
  const right = persistedAnswers && typeof persistedAnswers === 'object' ? persistedAnswers : {};
  if (preferPersisted) return { ...left, ...right };
  if (Object.keys(left).length === 0) return right;
  if (Object.keys(right).length === 0) return left;
  return { ...right, ...left };
}

function mergeTransitionTrail(runtimeTrail, persistedTrail) {
  const runtime = Array.isArray(runtimeTrail) ? runtimeTrail : [];
  const persisted = Array.isArray(persistedTrail) ? persistedTrail : [];
  if (persisted.length === 0) return runtime;
  if (runtime.length === 0) return persisted;
  if (isOrderedSubsequence(runtime, persisted)) return persisted;
  if (isOrderedSubsequence(persisted, runtime)) return runtime;
  return persisted.length >= runtime.length ? persisted : runtime;
}

function flowContextCompatible(runtimeSession, dbSession, conversation) {
  const runtimeFlowId = runtimeSession?.flowId || null;
  const dbFlowId = dbSession?.flowId || null;
  const conversationFlowId = conversation?.currentFlowId || null;
  const runtimeVersion = runtimeSession?.flowVersion || conversation?.currentFlowVersion || null;
  const dbVersion = dbSession?.flowVersion || conversation?.currentFlowVersion || null;
  const anchor = runtimeFlowId || conversationFlowId;
  if (!anchor || !dbFlowId) return true;
  if (String(anchor) !== String(dbFlowId)) return false;
  if (runtimeVersion && dbVersion && String(runtimeVersion) !== String(dbVersion)) {
    return false;
  }
  return true;
}

/**
 * Fusiona sesión runtime con tracking persistido para exportación.
 * @returns {Promise<{ session: object, source: 'runtime'|'merged'|'persisted', conflict: boolean }>}
 */
/**
 * Reconstruye sesión mínima desde SQL cuando no hay runtime.
 */
export async function rehydrateExportSessionFromConversation(conversation) {
  if (!conversation?.id) return null;
  try {
    const dbSession = await conversationSessionRepository.findLatestByConversationId(conversation.id);
    const base = classificationReconciliationService.buildSessionFromDbSession(conversation, dbSession);
    if (!Array.isArray(base.visitedNodes) || base.visitedNodes.length === 0) {
      return null;
    }
    return {
      ...base,
      provider: 'rehydrated',
      phone: conversation.phoneNumber || '',
      flowId: base.flowId || conversation.currentFlowId || null,
      flowVersion: base.flowVersion || conversation.currentFlowVersion || null,
    };
  } catch {
    return null;
  }
}

export async function buildExportSession({
  session,
  conversationId,
  conversation = null,
}) {
  if (!session) {
    return { session: null, source: 'runtime', conflict: false };
  }
  if (!conversationId) {
    return { session, source: 'runtime', conflict: false };
  }

  let dbSession = null;
  try {
    dbSession = await conversationSessionRepository.findLatestByConversationId(conversationId);
  } catch {
    return { session, source: 'runtime', conflict: false };
  }

  const tracking = dbSession?.trackingJson && typeof dbSession.trackingJson === 'object'
    ? dbSession.trackingJson
    : null;
  if (!tracking) {
    return { session, source: 'runtime', conflict: false };
  }

  if (!flowContextCompatible(session, dbSession, conversation)) {
    return { session, source: 'runtime', conflict: true };
  }

  const runtimeVisited = asStringArray(session.visitedNodes);
  const persistedVisited = asStringArray(tracking.visitedNodes);
  const mergedVisited = mergeVisitedNodes(runtimeVisited, persistedVisited);
  const runtimeAnswers = session.answers || {};
  const persistedAnswers = tracking.answers || {};
  const mergedAnswers = mergeAnswers(runtimeAnswers, persistedAnswers, {
    preferPersisted: persistedVisited.length > runtimeVisited.length,
  });
  const mergedTrail = mergeTransitionTrail(session.transitionTrail, tracking.transitionTrail);

  if (conversation?.status === 'closed' && dbSession?.conversationId === conversationId) {
    return {
      session: {
        ...session,
        flowId: dbSession.flowId || session.flowId,
        flowVersion: dbSession.flowVersion || session.flowVersion,
        visitedNodes: persistedVisited.length ? persistedVisited : runtimeVisited,
        answers: persistedAnswers,
        transitionTrail: mergedTrail,
      },
      source: 'persisted',
      conflict: false,
    };
  }

  const visitedConflict = runtimeVisited.length > 0
    && persistedVisited.length > 0
    && !isOrderedSubsequence(runtimeVisited, persistedVisited)
    && !isOrderedSubsequence(persistedVisited, runtimeVisited);
  const versionConflict = session.flowVersion && dbSession.flowVersion
    && String(session.flowVersion) !== String(dbSession.flowVersion);
  const conflict = visitedConflict || versionConflict;

  const merged = {
    ...session,
    flowId: session.flowId || dbSession.flowId || conversation?.currentFlowId || null,
    flowVersion: session.flowVersion || dbSession.flowVersion || conversation?.currentFlowVersion || null,
    visitedNodes: mergedVisited,
    answers: mergedAnswers,
    transitionTrail: mergedTrail,
    lastUserMessage: session.lastUserMessage || tracking.lastUserMessage || '',
    startedAt: session.startedAt || tracking.startedAt || conversation?.startedAt || null,
  };

  const answersUnchanged = JSON.stringify(mergedAnswers) === JSON.stringify(runtimeAnswers);
  const source = mergedVisited.length === runtimeVisited.length && answersUnchanged
    ? 'runtime'
    : 'merged';

  return { session: merged, source, conflict };
}

export {
  isOrderedSubsequence,
  mergeVisitedNodes,
};