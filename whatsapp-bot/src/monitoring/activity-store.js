const state = {
  processStartedAt: new Date().toISOString(),
  lastHealthCheckAt: null,
  lastInboundAt: null,
  lastOutboundAt: null,
  lastProcessedAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastSuccessfulFlowAt: null,
};

const FIELDS = new Set([
  'lastHealthCheckAt',
  'lastInboundAt',
  'lastOutboundAt',
  'lastProcessedAt',
  'lastErrorAt',
  'lastSuccessfulFlowAt',
]);

export function noteActivity(field, detail = null) {
  if (!FIELDS.has(field)) return null;
  const at = new Date().toISOString();
  state[field] = at;
  if (field === 'lastErrorAt') {
    state.lastErrorMessage = detail ? String(detail).slice(0, 200) : null;
  }
  return at;
}

export function getActivitySnapshot() {
  return { ...state };
}

export function resetActivityForTests() {
  state.processStartedAt = new Date().toISOString();
  state.lastHealthCheckAt = null;
  state.lastInboundAt = null;
  state.lastOutboundAt = null;
  state.lastProcessedAt = null;
  state.lastErrorAt = null;
  state.lastErrorMessage = null;
  state.lastSuccessfulFlowAt = null;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function laterTimestamp(left, right) {
  const leftIso = toIso(left);
  const rightIso = toIso(right);
  if (!leftIso) return rightIso;
  if (!rightIso) return leftIso;
  return new Date(leftIso).getTime() >= new Date(rightIso).getTime() ? leftIso : rightIso;
}

/**
 * Memory stays the fast path. A successful DB read can only move a timestamp
 * forward. A failed read does not invent timestamps and does not count as ok.
 */
export function mergeActivityTimestamps(memory, persisted) {
  const base = {
    lastInboundAt: memory.lastInboundAt,
    lastOutboundAt: memory.lastOutboundAt,
    lastProcessedAt: memory.lastProcessedAt,
    lastSuccessfulFlowAt: memory.lastSuccessfulFlowAt,
    lastErrorAt: memory.lastErrorAt,
    activityPersistenceOk: false,
  };
  if (persisted?.ok !== true) return base;
  return {
    ...base,
    lastInboundAt: laterTimestamp(memory.lastInboundAt, persisted.lastInboundAt),
    lastOutboundAt: laterTimestamp(memory.lastOutboundAt, persisted.lastOutboundAt),
    lastProcessedAt: laterTimestamp(memory.lastProcessedAt, persisted.lastProcessedAt),
    activityPersistenceOk: true,
  };
}
