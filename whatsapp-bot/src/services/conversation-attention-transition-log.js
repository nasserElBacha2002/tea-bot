/**
 * Logs estructurados stdout para transiciones bot ↔ operador (DIN-435).
 * Fallos de logging no deben afectar la operación de negocio.
 */

import crypto from 'node:crypto';
import { HUMAN_NODE_IDS } from '../utils/handoff-detection.js';

export const OUTCOMES = Object.freeze({
  confirmed: 'confirmed',
  rejected: 'rejected',
  aborted: 'aborted',
  idempotentReplay: 'idempotent_replay',
  error: 'error',
});

export const TRANSITION_TYPES = Object.freeze({
  botHandoff: 'bot_handoff',
  manualTakeover: 'manual_takeover',
  manualReassign: 'manual_reassign',
  legacyAssign: 'legacy_assign',
  returnToBot: 'return_to_bot',
  reopen: 'reopen',
  reentry: 'reentry',
  legacyNormalize: 'legacy_state_normalized',
});

export const REASON_CODES = Object.freeze({
  humanHandoff: 'human_handoff',
  fallbackHandoff: 'fallback_handoff',
  manualTakeover: 'manual_takeover',
  manualReassign: 'manual_reassign',
  waitingHumanClaim: 'waiting_human_claim',
  newInboundMessage: 'new_inbound_message',
  returnToBot: 'return_to_bot',
  inboxClose: 'inbox_close',
  inboxReturn: 'inbox_return',
  legacyNormalize: 'legacy_state_normalized',
  reentryInbound: 'reentry_inbound',
  reentryReplayed: 'reentry_replayed',
  reentryLegacyReturn: 'reentry_legacy_return',
  reentryInactivity: 'reentry_inactivity',
  reentryPolicyLegacy: 'reentry_policy_legacy',
  reentryHandoff: 'reentry_handoff',
});

export const ERROR_CODES = Object.freeze({
  unexpectedFailure: 'UNEXPECTED_FAILURE',
  runtimeResetFailed: 'RUNTIME_RESET_FAILED',
  historicalFlowUnavailable: 'HISTORICAL_FLOW_UNAVAILABLE',
  resumeFlowUnavailable: 'RESUME_FLOW_UNAVAILABLE',
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TWILIO_SID_REGEX = /^SM[0-9a-f]{32}$/i;
const LOG_CORRELATION_NAMESPACE = 'din435:correlation:v1:';
const TECHNICAL_ERROR_CODES = new Set([
  ...Object.values(ERROR_CODES),
  'ETIMEOUT',
  'ECONNRESET',
  'CONVERSATION_PERSISTENCE_UNAVAILABLE',
]);
const OPERATIONAL_ERROR_CODES = new Set([
  'FORBIDDEN',
  'NOT_FOUND',
  'CONVERSATION_CLOSED',
  'CONVERSATION_OWNED',
  'INVALID_STATE',
  'STATUS_VERSION_CONFLICT',
  'TAKEOVER_DISABLED',
  'REASON_REQUIRED',
  'TARGET_REQUIRED',
  'TARGET_AGENT_NOT_FOUND',
  'CONVERSATION_NOT_ASSIGNED',
  'HANDOFF_NOT_ACTIVE',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_STALE',
  'CONVERSATION_BOT_ACTIVE',
  'ATTACHMENT_NOT_AVAILABLE',
  'VALIDATION',
]);
const CONVERSATION_STATUSES = new Set(['bot', 'waiting_human', 'assigned', 'paused', 'closed']);
const KNOWN_LOG_NODE_KEYS = new Set([...HUMAN_NODE_IDS, 'welcome']);
const REENTRY_ACTION_CODES = new Set([
  'handoff', 'prompt', 'present_node', 'present_entry', 'fresh', 'continue',
  'legacy_cleared', 'reprompt', 'human_skip', 'delegate',
  'reentry_inbound', 'reentry_legacy_rollback', 'reentry_historical_flow_unavailable',
  'reentry_runtime_reset_failed', 'reentry_resume_flow_unavailable',
]);
const AUXILIARY_LEGACY_EVENTS = new Set([
  'manual_takeover_runtime_reset_failed',
  'manual_takeover_notify_failed',
]);

const ALLOWED_KEYS = new Set([
  'transitionType',
  'conversationId',
  'handoffId',
  'correlationId',
  'previousStatus',
  'newStatus',
  'reasonCode',
  'actorKind',
  'actorAgentId',
  'outcome',
  'errorCode',
  'durationMs',
  'statusVersion',
  'handoffCreated',
  'reentryArmed',
  'resolvedHandoffCount',
  'resolvedHandoffIds',
  'endedSessionCount',
  'runtimeReset',
  'runtimeResetFailed',
  'resumeNodeKey',
  'reentryAction',
  'nodeKey',
  'replayed',
]);

const LEGACY_SAFE_KEYS = new Set([
  'conversationId',
  'correlationId',
  'previousStatus',
  'newStatus',
  'reasonCode',
  'reentryAction',
  'outcome',
  'errorCode',
  'resolvedHandoffCount',
  'resolvedHandoffIds',
  'endedSessionCount',
  'reentryArmed',
  'runtimeReset',
  'runtimeResetFailed',
  'resumeNodeKey',
  'nodeKey',
  'previousNodeKey',
]);

const AUXILIARY_SAFE_KEYS = new Set([
  'conversationId',
  'correlationId',
  'errorCode',
  'outcome',
]);

const CONTROLLED_REASON_CODES = new Set(Object.values(REASON_CODES));
const ALLOWED_ACTOR_KIND = new Set(['bot', 'operator', 'system']);

function sanitizeUuid(value) {
  const text = value == null ? null : String(value).trim();
  if (!text || !UUID_REGEX.test(text)) return null;
  return text.toLowerCase();
}

function isTrustedLoggingCorrelationId(value) {
  const text = value == null ? null : String(value).trim();
  if (!text) return null;
  if (UUID_REGEX.test(text)) return text.toLowerCase();
  if (TWILIO_SID_REGEX.test(text)) return text;
  return null;
}

/**
 * UUID determinístico para logs; no expone valores crudos del cliente.
 * @param {string} raw
 */
export function internalLoggingCorrelationId(raw) {
  const text = String(raw).trim();
  const hash = crypto.createHash('sha256').update(`${LOG_CORRELATION_NAMESPACE}${text}`).digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function resolveLoggingCorrelationId(value) {
  const trusted = isTrustedLoggingCorrelationId(value);
  if (trusted) return trusted;
  const text = value == null ? null : String(value).trim();
  if (!text) return null;
  return internalLoggingCorrelationId(text);
}

function sanitizeCorrelationId(value) {
  return resolveLoggingCorrelationId(value);
}

function sanitizeKnownNodeKey(value) {
  const text = value == null ? null : String(value).trim();
  if (!text || !KNOWN_LOG_NODE_KEYS.has(text)) return null;
  return text;
}

function sanitizeConversationStatus(value) {
  const text = value == null ? null : String(value).trim();
  if (!text || !CONVERSATION_STATUSES.has(text)) return null;
  return text;
}

function sanitizeReentryAction(value) {
  const text = value == null ? null : String(value).trim();
  if (!text || !REENTRY_ACTION_CODES.has(text)) return null;
  return text;
}

function sanitizeErrorCode(value) {
  const text = value == null ? null : String(value).trim();
  if (!text) return null;
  if (TECHNICAL_ERROR_CODES.has(text)) return text;
  if (OPERATIONAL_ERROR_CODES.has(text)) return text;
  return null;
}

function sanitizeReasonCode(value) {
  const code = value == null ? null : String(value).trim();
  if (!code || !CONTROLLED_REASON_CODES.has(code)) return null;
  return code;
}

function sanitizeResolvedHandoffIds(value) {
  if (!Array.isArray(value)) return null;
  const ids = [];
  for (const item of value) {
    const id = sanitizeUuid(item);
    if (id) ids.push(id);
    if (ids.length >= 32) break;
  }
  return ids.length > 0 ? ids : null;
}

function sanitizePayload(raw, allowed = ALLOWED_KEYS) {
  if (!raw || typeof raw !== 'object') return {};
  const event = {};
  for (const key of allowed) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (value === undefined) continue;
    if (key === 'reasonCode') {
      const code = sanitizeReasonCode(value);
      if (code) event.reasonCode = code;
      continue;
    }
    if (key === 'errorCode') {
      const code = sanitizeErrorCode(value);
      if (code) event.errorCode = code;
      continue;
    }
    if (key === 'correlationId') {
      const id = sanitizeCorrelationId(value) || sanitizeUuid(value);
      if (id) event.correlationId = id;
      continue;
    }
    if (key === 'conversationId' || key === 'handoffId' || key === 'actorAgentId') {
      const id = sanitizeUuid(value);
      if (id) event[key] = id;
      continue;
    }
    if (key === 'resolvedHandoffIds') {
      const ids = sanitizeResolvedHandoffIds(value);
      if (ids) event.resolvedHandoffIds = ids;
      continue;
    }
    if (key === 'previousStatus' || key === 'newStatus') {
      const status = sanitizeConversationStatus(value);
      if (status) event[key] = status;
      continue;
    }
    if (key === 'nodeKey' || key === 'resumeNodeKey' || key === 'previousNodeKey') {
      const nodeKey = sanitizeKnownNodeKey(value);
      if (nodeKey) event[key] = nodeKey;
      continue;
    }
    if (key === 'actorKind') {
      const kind = value == null ? null : String(value).trim();
      if (kind && ALLOWED_ACTOR_KIND.has(kind)) event.actorKind = kind;
      continue;
    }
    if (key === 'durationMs' || key === 'statusVersion' || key === 'resolvedHandoffCount'
      || key === 'endedSessionCount') {
      if (value == null) continue;
      const num = Number(value);
      if (Number.isFinite(num)) event[key] = Math.round(num);
      continue;
    }
    if (key === 'handoffCreated' || key === 'reentryArmed' || key === 'runtimeReset'
      || key === 'runtimeResetFailed' || key === 'replayed') {
      event[key] = Boolean(value);
      continue;
    }
    if (key === 'transitionType') {
      if (Object.values(TRANSITION_TYPES).includes(value)) event.transitionType = value;
      continue;
    }
    if (key === 'outcome') {
      if (Object.values(OUTCOMES).includes(value)) event.outcome = value;
      continue;
    }
    if (key === 'reentryAction') {
      const action = sanitizeReentryAction(value);
      if (action) event.reentryAction = action;
      continue;
    }
  }
  return event;
}

/**
 * @param {Record<string, unknown>} payload
 */
export function logAttentionTransition(payload) {
  try {
    const body = sanitizePayload(payload);
    if (!body.transitionType || !body.outcome) return;
    if (!body.correlationId) {
      body.correlationId = ensureCorrelationId();
    }
    console.log(JSON.stringify({
      event: 'conversation_attention_transition',
      ...body,
    }));
  } catch {
    // swallow — logging must not change business outcome
  }
}

/**
 * Compatibilidad con consumidores que escuchan eventos históricos (sin PII).
 * @param {string} legacyEvent
 * @param {Record<string, unknown>} payload
 */
export function logLegacyAttentionEvent(legacyEvent, payload = {}) {
  try {
    const allowedLegacy = new Set([
      'conversation_returned_to_bot',
      'conversation_runtime_reset_failed',
      'conversation_legacy_state_normalized',
      'reentry_inbound',
      'reentry_legacy_rollback',
      'reentry_historical_flow_unavailable',
      'reentry_runtime_reset_failed',
      'reentry_resume_flow_unavailable',
    ]);
    const event = legacyEvent == null ? null : String(legacyEvent).trim();
    if (!event || !allowedLegacy.has(event)) return;
    console.log(JSON.stringify({
      event,
      ...sanitizePayload(payload, LEGACY_SAFE_KEYS),
    }));
  } catch {
    // swallow
  }
}

/**
 * @param {unknown} value
 */
export function ensureCorrelationId(value = null) {
  if (value == null) return crypto.randomUUID();
  if (typeof value === 'string') {
    return resolveLoggingCorrelationId(value) || crypto.randomUUID();
  }
  const fromInbound = correlationFromInboundEvent(value);
  return fromInbound || crypto.randomUUID();
}

/**
 * @param {{ messageId?: string, providerMessageId?: string, correlationId?: string }} [event]
 */
export function correlationFromInboundEvent(event = {}) {
  if (event.correlationId) {
    return resolveLoggingCorrelationId(event.correlationId);
  }
  if (event.messageId) return resolveLoggingCorrelationId(event.messageId);
  if (event.providerMessageId) return resolveLoggingCorrelationId(event.providerMessageId);
  return null;
}

/**
 * @param {unknown} terminalReason
 */
export function reasonCodeForHandoff(terminalReason) {
  if (terminalReason === 'fallback_handoff') return REASON_CODES.fallbackHandoff;
  return REASON_CODES.humanHandoff;
}

/**
 * @param {unknown} reason
 */
export function reasonCodeForReentry(reason) {
  const code = reason == null ? null : String(reason).trim();
  switch (code) {
    case 'replayed_effect':
      return REASON_CODES.reentryReplayed;
    case 'legacy_return':
      return REASON_CODES.reentryLegacyReturn;
    case 'inactivity':
      return REASON_CODES.reentryInactivity;
    case 'policy_legacy':
      return REASON_CODES.reentryPolicyLegacy;
    case 'new_handoff':
      return REASON_CODES.reentryHandoff;
    default:
      return REASON_CODES.reentryInbound;
  }
}

/**
 * @param {{ code?: string }} [error]
 */
export function outcomeFromError(error) {
  const raw = error?.code == null ? null : String(error.code).trim();
  if (!raw) {
    return { outcome: OUTCOMES.error, errorCode: ERROR_CODES.unexpectedFailure };
  }
  if (TECHNICAL_ERROR_CODES.has(raw)) {
    return { outcome: OUTCOMES.error, errorCode: raw };
  }
  if (OPERATIONAL_ERROR_CODES.has(raw)) {
    return { outcome: OUTCOMES.rejected, errorCode: raw };
  }
  return { outcome: OUTCOMES.error, errorCode: ERROR_CODES.unexpectedFailure };
}

/**
 * Eventos auxiliares históricos (sin mensajes crudos ni PII).
 * @param {string} legacyEvent
 * @param {Record<string, unknown>} payload
 */
export function logAuxiliaryAttentionEvent(legacyEvent, payload = {}) {
  try {
    const event = legacyEvent == null ? null : String(legacyEvent).trim();
    if (!event || !AUXILIARY_LEGACY_EVENTS.has(event)) return;
    const safe = sanitizePayload(payload, AUXILIARY_SAFE_KEYS);
    console.log(JSON.stringify({ event, ...safe }));
  } catch {
    // swallow
  }
}

/**
 * Captura líneas de log en tests (sin tocar console global permanentemente).
 * @param {() => Promise<void>} fn
 */
export async function captureAttentionTransitionLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    for (const arg of args) {
      if (typeof arg === 'string') lines.push(arg);
    }
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row?.event === 'conversation_attention_transition');
}

/**
 * @param {() => Promise<void>} fn
 */
export async function captureAllStructuredLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    for (const arg of args) {
      if (typeof arg === 'string') lines.push(arg);
    }
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}