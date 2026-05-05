import sessionService from './session.service.js';

const MAX_VISITED_NODES = 200;
const MAX_TRANSITION_TRAIL = 200;

function deriveProviderAndPhone(userId) {
  const raw = String(userId || '');
  const [provider = 'unknown', rest = ''] = raw.split(':');
  const normalizedPhone = rest.replace(/^whatsapp:/i, '').replace(/^meta:/i, '');
  return {
    provider,
    phone: normalizedPhone || rest || raw,
  };
}

class ConversationTrackerService {
  async ensureSessionContext(userId, flow, session = null, perfContext = null) {
    const current = session || sessionService.getSession(userId, perfContext);
    if (!current) return null;
    const { provider, phone } = deriveProviderAndPhone(userId);
    const patch = {};
    if (!current.startedAt) patch.startedAt = new Date().toISOString();
    patch.lastMessageAt = new Date().toISOString();
    if (!Array.isArray(current.visitedNodes)) patch.visitedNodes = [];
    if (!current.answers || typeof current.answers !== 'object') patch.answers = {};
    if (!current.provider) patch.provider = provider;
    if (!current.phone) patch.phone = phone;
    if (!current.flowVersion && flow?.version) patch.flowVersion = flow.version;
    if (!current.flowId && flow?.id) patch.flowId = flow.id;
    if (Object.keys(patch).length === 0) return current;
    console.log(`[ConversationTracker] session_context_initialized user=${provider}:${phone}`);
    return sessionService.updateSession(userId, patch, perfContext);
  }

  buildNodeVisitPatch(session, nodeId) {
    const visited = Array.isArray(session?.visitedNodes) ? [...session.visitedNodes] : [];
    if (!nodeId) return { visitedNodes: visited };
    if (visited[visited.length - 1] !== nodeId) {
      visited.push(nodeId);
    }
    if (visited.length > MAX_VISITED_NODES) {
      visited.splice(0, visited.length - MAX_VISITED_NODES);
    }
    return { visitedNodes: visited };
  }

  buildTrackingPatch(session, transition) {
    const track = transition?.track;
    if (!track || !track.key) return {};
    const key = String(track.key).trim();
    if (!key) return {};
    const answers = {
      ...(session?.answers && typeof session.answers === 'object' ? session.answers : {}),
      [key]: track.value ?? null,
    };
    console.log(`[ConversationTracker] tracked_answer key=${key}`);
    return { answers };
  }

  buildTransitionTrailPatch(session, fromNodeId, nextNodeId, transition, fallbackLabel = '') {
    if (!fromNodeId || !nextNodeId) return {};
    const trail = Array.isArray(session?.transitionTrail) ? [...session.transitionTrail] : [];
    const transitionLabel = transition?.track?.label || transition?.label || '';
    const label = String(transitionLabel || fallbackLabel || '').trim();
    trail.push({
      from: fromNodeId,
      to: nextNodeId,
      ...(label ? { label } : {}),
    });
    if (trail.length > MAX_TRANSITION_TRAIL) {
      trail.splice(0, trail.length - MAX_TRANSITION_TRAIL);
    }
    return { transitionTrail: trail };
  }

  buildMessagePatch(message) {
    return {
      lastMessageAt: new Date().toISOString(),
      lastUserMessage: String(message || '').slice(0, 500),
    };
  }

  buildFallbackPatch(session) {
    return {
      fallbackCount: Number(session?.fallbackCount || 0) + 1,
    };
  }
}

const conversationTracker = new ConversationTrackerService();
export default conversationTracker;
