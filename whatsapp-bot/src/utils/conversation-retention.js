const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Semántica: lastMessageAt < cutoff (estrictamente anterior).
 * Una conversación exactamente en el cutoff se conserva.
 *
 * lastMessageAt NULL: se usa startedAt. Justificación: el schema permite NULL
 * pero createConversation siempre setea last_message_at; si quedara NULL,
 * started_at (NOT NULL) es la mejor señal de inactividad.
 *
 * @param {Date} now
 * @param {number} retentionDays
 * @returns {Date}
 */
export function computeRetentionCutoff(now, retentionDays) {
  const days = Number(retentionDays);
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
  const reference = now instanceof Date ? now : new Date(now);
  return new Date(reference.getTime() - safeDays * MS_PER_DAY);
}

/**
 * @param {{ lastMessageAt?: Date | string | null, startedAt?: Date | string | null }} conversation
 * @param {Date} cutoff
 * @returns {boolean}
 */
export function isConversationPastRetention(conversation, cutoff) {
  if (!conversation || !cutoff) return false;
  const raw = conversation.lastMessageAt ?? conversation.startedAt;
  if (raw == null || raw === '') return false;
  const activityAt = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(activityAt.getTime())) return false;
  return activityAt.getTime() < cutoff.getTime();
}

export const RETENTION_BATCH_SIZE_DEFAULT = 100;
export const RETENTION_BATCH_SIZE_MAX = 500;

export function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function clampRetentionBatchSize(value) {
  return Math.min(parsePositiveInt(value, RETENTION_BATCH_SIZE_DEFAULT), RETENTION_BATCH_SIZE_MAX);
}
