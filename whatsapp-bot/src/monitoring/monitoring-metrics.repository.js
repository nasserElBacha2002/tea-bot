import { query } from '../db/index.js';
import { ARGENTINA_PRESENTATION_TZ } from './whatsapp-daily-metrics.js';

const TZ = ARGENTINA_PRESENTATION_TZ;

function normalizeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const WINDOW_BOUNDS_SQL = `
WITH bounds AS (
  SELECT
    CAST(($1 AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date) AS end_day_ar
),
span AS (
  SELECT
    DATEADD(day, -($2 - 1), b.end_day_ar) AS start_day_ar,
    b.end_day_ar AS end_day_ar,
    CAST(DATEADD(day, -($2 - 1), b.end_day_ar) AS datetime2)
      AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS start_utc,
    DATEADD(day, 1, CAST(b.end_day_ar AS datetime2))
      AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
  FROM bounds b
)
SELECT
  CONVERT(varchar(10), s.start_day_ar, 23) AS start_day_ar,
  CONVERT(varchar(10), s.end_day_ar, 23) AS end_day_ar,
  s.start_utc,
  s.end_utc_exclusive
FROM span s;
`;

const NEW_CONVERSATIONS_DAILY_SQL = `
WITH bounds AS (
  SELECT CAST(($1 AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date) AS end_day_ar
),
span AS (
  SELECT
    DATEADD(day, -($2 - 1), b.end_day_ar) AS start_day_ar,
    CAST(DATEADD(day, -($2 - 1), b.end_day_ar) AS datetime2)
      AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS start_utc,
    DATEADD(day, 1, CAST(b.end_day_ar AS datetime2))
      AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
  FROM bounds b
)
SELECT
  CONVERT(varchar(10),
    CAST((c.started_at AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date),
    23
  ) AS day_ar,
  COUNT(*) AS new_conversations
FROM dbo.conversations c
CROSS JOIN span s
WHERE c.started_at >= s.start_utc
  AND c.started_at < s.end_utc_exclusive
GROUP BY CAST((c.started_at AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date)
ORDER BY day_ar;
`;

const PERIOD_MESSAGE_TOTALS_SQL = `
WITH bounds AS (
  SELECT CAST(($1 AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date) AS end_day_ar
),
span AS (
  SELECT
    CAST(DATEADD(day, -($2 - 1), b.end_day_ar) AS datetime2)
      AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS start_utc,
    DATEADD(day, 1, CAST(b.end_day_ar AS datetime2))
      AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
  FROM bounds b
)
SELECT
  SUM(CASE WHEN m.direction = N'inbound' THEN 1 ELSE 0 END) AS inbound,
  SUM(CASE WHEN m.direction = N'outbound' THEN 1 ELSE 0 END) AS outbound,
  SUM(CASE WHEN m.direction = N'outbound' AND m.sender_type = N'bot' THEN 1 ELSE 0 END) AS outbound_bot,
  SUM(CASE WHEN m.direction = N'outbound' AND m.sender_type = N'agent' THEN 1 ELSE 0 END) AS outbound_agent,
  SUM(CASE WHEN m.direction = N'outbound' AND m.sender_type = N'system' THEN 1 ELSE 0 END) AS outbound_system
FROM dbo.conversation_messages m
CROSS JOIN span s
WHERE m.created_at >= s.start_utc
  AND m.created_at < s.end_utc_exclusive;
`;

export async function resolveMetricsWindow({ asOf, days }) {
  const { rows } = await query(WINDOW_BOUNDS_SQL, [asOf, days]);
  return rows[0] || null;
}

export async function getConversationStatusSnapshot() {
  const { rows } = await query(
    `SELECT
       SUM(CASE WHEN status <> N'closed' THEN 1 ELSE 0 END) AS active_now,
       SUM(CASE WHEN status = N'closed' THEN 1 ELSE 0 END) AS closed_now,
       SUM(CASE WHEN status = N'waiting_human' THEN 1 ELSE 0 END) AS waiting_human_now,
       SUM(CASE WHEN status = N'assigned' THEN 1 ELSE 0 END) AS assigned_now,
       SUM(CASE WHEN status = N'bot' THEN 1 ELSE 0 END) AS bot_managed_now,
       SUM(CASE WHEN status = N'paused' THEN 1 ELSE 0 END) AS paused_now
     FROM dbo.conversations`,
  );
  const row = rows[0] || {};
  return {
    active: normalizeCount(row.active_now),
    closed: normalizeCount(row.closed_now),
    waitingHuman: normalizeCount(row.waiting_human_now),
    assigned: normalizeCount(row.assigned_now),
    botManaged: normalizeCount(row.bot_managed_now),
    paused: normalizeCount(row.paused_now),
    snapshotAt: new Date().toISOString(),
    definition:
      'Instantáneo por status actual en dbo.conversations; activas = status distinto de closed.',
  };
}

export async function getNewConversationsDaily(asOf, days) {
  const { rows } = await query(NEW_CONVERSATIONS_DAILY_SQL, [asOf, days]);
  return rows.map((row) => ({
    dayAr: row.day_ar,
    newConversations: normalizeCount(row.new_conversations),
  }));
}

export async function getPeriodMessageTotals(asOf, days) {
  const { rows } = await query(PERIOD_MESSAGE_TOTALS_SQL, [asOf, days]);
  const row = rows[0] || {};
  const outboundBot = normalizeCount(row.outbound_bot);
  const outboundAgent = normalizeCount(row.outbound_agent);
  return {
    inbound: normalizeCount(row.inbound),
    outbound: normalizeCount(row.outbound),
    outboundBot,
    outboundAgent,
    outboundSystem: normalizeCount(row.outbound_system),
    whatsappOutbound: outboundBot + outboundAgent,
  };
}

export async function getHandoffCurrentCounts() {
  const { rows } = await query(
    `SELECT
       status,
       COUNT(*) AS total
     FROM dbo.human_handoffs
     GROUP BY status`,
  );
  const byStatus = {};
  for (const row of rows) {
    byStatus[String(row.status || '').toLowerCase()] = normalizeCount(row.total);
  }
  const pendingAge = await query(
    `SELECT
       COUNT(*) AS pending_count,
       MIN(requested_at) AS oldest_requested_at
     FROM dbo.human_handoffs
     WHERE status = N'pending'`,
  );
  const ageRow = pendingAge.rows[0] || {};
  let oldestPendingAgeMinutes = null;
  if (ageRow.oldest_requested_at) {
    const ageMs = Date.now() - new Date(ageRow.oldest_requested_at).getTime();
    oldestPendingAgeMinutes = Math.max(0, Math.round(ageMs / 60000));
  }
  return {
    byStatus,
    pending: byStatus.pending ?? null,
    assigned: byStatus.assigned ?? null,
    resolved: byStatus.resolved ?? null,
    oldestPendingRequestedAt: ageRow.oldest_requested_at || null,
    oldestPendingAgeMinutes,
  };
}

export async function getHandoffPeriodStats(asOf, days) {
  const window = await resolveMetricsWindow({ asOf, days });
  if (!window) return { createdInPeriod: null, avgMinutesToAssign: null, avgMinutesToResolve: null };
  const { rows } = await query(
    `SELECT
       COUNT(*) AS created_in_period,
       AVG(CASE
         WHEN assigned_at IS NOT NULL AND assigned_at >= $1 AND assigned_at < $2
           THEN DATEDIFF(minute, requested_at, assigned_at)
       END) AS avg_minutes_to_assign,
       AVG(CASE
         WHEN resolved_at IS NOT NULL AND resolved_at >= $1 AND resolved_at < $2
           THEN DATEDIFF(minute, requested_at, resolved_at)
       END) AS avg_minutes_to_resolve
     FROM dbo.human_handoffs
     WHERE requested_at >= $1 AND requested_at < $2`,
    [window.start_utc, window.end_utc_exclusive],
  );
  const row = rows[0] || {};
  return {
    createdInPeriod: normalizeCount(row.created_in_period),
    avgMinutesToAssign: normalizeMs(row.avg_minutes_to_assign),
    avgMinutesToResolve: normalizeMs(row.avg_minutes_to_resolve),
  };
}

export async function getHandoffDailyCreated(asOf, days) {
  const { rows } = await query(
    `WITH bounds AS (
       SELECT CAST(($1 AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date) AS end_day_ar
     ),
     span AS (
       SELECT
         CAST(DATEADD(day, -($2 - 1), b.end_day_ar) AS datetime2)
           AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS start_utc,
         DATEADD(day, 1, CAST(b.end_day_ar AS datetime2))
           AT TIME ZONE N'${TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
       FROM bounds b
     )
     SELECT
       CONVERT(varchar(10),
         CAST((h.requested_at AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date),
         23
       ) AS day_ar,
       COUNT(*) AS created
     FROM dbo.human_handoffs h
     CROSS JOIN span s
     WHERE h.requested_at >= s.start_utc
       AND h.requested_at < s.end_utc_exclusive
     GROUP BY CAST((h.requested_at AT TIME ZONE 'UTC') AT TIME ZONE N'${TZ}' AS date)
     ORDER BY day_ar`,
    [asOf, days],
  );
  return rows.map((row) => ({ dayAr: row.day_ar, created: normalizeCount(row.created) }));
}

export async function getSheetSyncJobSnapshot() {
  const tableExists = await query(
    `SELECT OBJECT_ID(N'dbo.conversation_sheet_sync_jobs', N'U') AS object_id`,
  );
  if (!tableExists.rows[0]?.object_id) {
    return { available: false, reason: 'TABLE_NOT_PRESENT' };
  }
  const counts = await query(
    `SELECT status, COUNT(*) AS total
     FROM dbo.conversation_sheet_sync_jobs
     GROUP BY status`,
  );
  const byStatus = {};
  for (const row of counts.rows) {
    byStatus[String(row.status || '').toLowerCase()] = normalizeCount(row.total);
  }
  const oldestPending = await query(
    `SELECT TOP (1) created_at
     FROM dbo.conversation_sheet_sync_jobs
     WHERE status IN (N'pending', N'failed', N'processing')
     ORDER BY created_at ASC`,
  );
  const lastSuccess = await query(
    `SELECT MAX(updated_at) AS last_success_at
     FROM dbo.conversation_sheet_sync_jobs
     WHERE status = N'completed'`,
  );
  let oldestPendingAgeMinutes = null;
  const oldestAt = oldestPending.rows[0]?.created_at;
  if (oldestAt) {
    oldestPendingAgeMinutes = Math.max(0, Math.round((Date.now() - new Date(oldestAt).getTime()) / 60000));
  }
  return {
    available: true,
    byStatus,
    pending: (byStatus.pending ?? 0) + (byStatus.processing ?? 0),
    failed: byStatus.failed ?? null,
    retrying: byStatus.failed ?? null,
    completed: byStatus.completed ?? null,
    exhausted: byStatus.exhausted ?? null,
    lastSuccessAt: lastSuccess.rows[0]?.last_success_at || null,
    oldestPendingAt: oldestAt || null,
    oldestPendingAgeMinutes,
  };
}

export async function getWebhookStatusCounts(since) {
  const { rows } = await query(
    `SELECT status, COUNT(*) AS total
     FROM dbo.provider_webhook_events
     WHERE received_at >= $1
     GROUP BY status
     ORDER BY status`,
    [since],
  );
  return rows.map((row) => ({
    status: String(row.status || ''),
    count: normalizeCount(row.total),
  }));
}

export async function getPeriodDeliveryFailures(asOf, days) {
  const window = await resolveMetricsWindow({ asOf, days });
  if (!window) return null;
  const { rows } = await query(
    `SELECT COUNT(*) AS failed
     FROM dbo.message_delivery_status
     WHERE status IN (N'failed', N'undelivered')
       AND status_at >= $1
       AND status_at < $2`,
    [window.start_utc, window.end_utc_exclusive],
  );
  return normalizeCount(rows[0]?.failed);
}

export default {
  getConversationStatusSnapshot,
  getHandoffCurrentCounts,
  getHandoffDailyCreated,
  getHandoffPeriodStats,
  getNewConversationsDaily,
  getPeriodDeliveryFailures,
  getPeriodMessageTotals,
  getSheetSyncJobSnapshot,
  getWebhookStatusCounts,
  resolveMetricsWindow,
};