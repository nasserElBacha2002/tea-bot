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
