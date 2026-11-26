import { query, isConversationDbEnabled } from '../db/index.js';

/** Presentación operativa (día civil Argentina). `created_at` / `status_at` se interpretan como UTC. */
export const ARGENTINA_PRESENTATION_TZ = 'Argentina Standard Time';

export const TEMPLATE_METRIC_LIMITATION = {
  available: false,
  reason: 'NO_TEMPLATE_DIMENSION_IN_SCHEMA',
};

const MIN_DAYS = 1;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 30;

const WINDOW_SQL = `
WITH bounds AS (
  SELECT
    CAST(($1 AT TIME ZONE 'UTC') AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AS date) AS end_day_ar
),
span AS (
  SELECT
    DATEADD(day, -($2 - 1), b.end_day_ar) AS start_day_ar,
    b.end_day_ar AS end_day_ar,
    CAST(DATEADD(day, -($2 - 1), b.end_day_ar) AS datetime2)
      AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS start_utc,
    DATEADD(day, 1, CAST(b.end_day_ar AS datetime2))
      AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
  FROM bounds b
)
SELECT
  CONVERT(varchar(10), s.start_day_ar, 23) AS start_day_ar,
  CONVERT(varchar(10), s.end_day_ar, 23) AS end_day_ar,
  s.start_utc,
  s.end_utc_exclusive
FROM span s;
`;

const DAILY_MESSAGES_SQL = `
WITH bounds AS (
  SELECT
    CAST(($1 AT TIME ZONE 'UTC') AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AS date) AS end_day_ar
),
span AS (
  SELECT
    DATEADD(day, -($2 - 1), b.end_day_ar) AS start_day_ar,
    b.end_day_ar AS end_day_ar,
    CAST(DATEADD(day, -($2 - 1), b.end_day_ar) AS datetime2)
      AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS start_utc,
    DATEADD(day, 1, CAST(b.end_day_ar AS datetime2))
      AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
  FROM bounds b
),
scoped AS (
  SELECT
    m.conversation_id,
    m.direction,
    m.sender_type,
    CAST((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AS date) AS day_ar
  FROM dbo.conversation_messages m
  INNER JOIN dbo.conversations c ON c.id = m.conversation_id
  CROSS JOIN span s
  WHERE c.channel = N'whatsapp'
    AND c.provider = N'twilio'
    AND m.created_at >= s.start_utc
    AND m.created_at < s.end_utc_exclusive
)
SELECT
  CONVERT(varchar(10), day_ar, 23) AS day_ar,
  SUM(CASE WHEN direction = N'inbound' THEN 1 ELSE 0 END) AS inbound,
  SUM(CASE WHEN direction = N'outbound' THEN 1 ELSE 0 END) AS outbound,
  SUM(CASE WHEN direction = N'outbound' AND sender_type = N'bot' THEN 1 ELSE 0 END) AS outbound_bot,
  SUM(CASE WHEN direction = N'outbound' AND sender_type = N'agent' THEN 1 ELSE 0 END) AS outbound_agent,
  SUM(CASE WHEN direction = N'outbound' AND sender_type = N'system' THEN 1 ELSE 0 END) AS outbound_system,
  COUNT(DISTINCT conversation_id) AS unique_conversations
FROM scoped
GROUP BY day_ar
ORDER BY day_ar;
`;

const RANGE_WINDOW_SQL = `
SELECT
  CONVERT(varchar(10), CAST($1 AS date), 23) AS start_day_ar,
  CONVERT(varchar(10), CAST($2 AS date), 23) AS end_day_ar,
  CAST(CAST($1 AS datetime2) AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS datetime2) AS start_utc,
  DATEADD(day, 1, CAST($2 AS datetime2))
    AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive;
`;

const DAILY_MESSAGES_RANGE_SQL = `
WITH span AS (
  SELECT
    CAST($1 AS date) AS start_day_ar,
    CAST($2 AS date) AS end_day_ar,
    CAST(CAST($1 AS datetime2) AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS datetime2) AS start_utc,
    DATEADD(day, 1, CAST($2 AS datetime2))
      AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
),
scoped AS (
  SELECT
    m.conversation_id,
    m.direction,
    m.sender_type,
    CAST((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AS date) AS day_ar
  FROM dbo.conversation_messages m
  INNER JOIN dbo.conversations c ON c.id = m.conversation_id
  CROSS JOIN span s
  WHERE c.channel = N'whatsapp'
    AND c.provider = N'twilio'
    AND m.created_at >= s.start_utc
    AND m.created_at < s.end_utc_exclusive
)
SELECT
  CONVERT(varchar(10), day_ar, 23) AS day_ar,
  SUM(CASE WHEN direction = N'inbound' THEN 1 ELSE 0 END) AS inbound,
  SUM(CASE WHEN direction = N'outbound' THEN 1 ELSE 0 END) AS outbound,
  SUM(CASE WHEN direction = N'outbound' AND sender_type = N'bot' THEN 1 ELSE 0 END) AS outbound_bot,
  SUM(CASE WHEN direction = N'outbound' AND sender_type = N'agent' THEN 1 ELSE 0 END) AS outbound_agent,
  SUM(CASE WHEN direction = N'outbound' AND sender_type = N'system' THEN 1 ELSE 0 END) AS outbound_system,
  COUNT(DISTINCT conversation_id) AS unique_conversations
FROM scoped
GROUP BY day_ar
ORDER BY day_ar;
`;

const DELIVERY_BY_DAY_SQL = `
WITH bounds AS (
  SELECT
    CAST(($1 AT TIME ZONE 'UTC') AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AS date) AS end_day_ar
),
span AS (
  SELECT
    DATEADD(day, -($2 - 1), b.end_day_ar) AS start_day_ar,
    b.end_day_ar AS end_day_ar,
    CAST(DATEADD(day, -($2 - 1), b.end_day_ar) AS datetime2)
      AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS start_utc,
    DATEADD(day, 1, CAST(b.end_day_ar AS datetime2))
      AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS end_utc_exclusive
  FROM bounds b
)
SELECT
  CONVERT(varchar(10),
    CAST((d.status_at AT TIME ZONE 'UTC') AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AS date),
    23
  ) AS day_ar,
  d.status,
  COUNT(*) AS sid_count
FROM dbo.message_delivery_status d
CROSS JOIN span s
WHERE d.provider = N'twilio'
  AND d.status_at >= s.start_utc
  AND d.status_at < s.end_utc_exclusive
GROUP BY
  CAST((d.status_at AT TIME ZONE 'UTC') AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AS date),
  d.status
ORDER BY day_ar, d.status;
`;

/**
 * Identidad sintética del outbound TwiML por turno ({inboundSid}:outbound o hash `out_…`).
 * No debe tratarse como SID Twilio facturable ni unirse a `message_delivery_status`.
 */
export function isSyntheticTwilioOutboundProviderMessageId(providerMessageId) {
  if (providerMessageId == null || providerMessageId === '') return false;
  const value = String(providerMessageId);
  if (value.endsWith(':outbound')) return true;
  if (value.startsWith('out_')) return true;
  return false;
}

export function clampMetricsDays(days) {
  const numeric = Number(days);
  if (!Number.isFinite(numeric)) return DEFAULT_DAYS;
  return Math.min(Math.max(Math.trunc(numeric), MIN_DAYS), MAX_DAYS);
}

function normalizeCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapDailyMessageRow(row) {
  const inbound = normalizeCount(row.inbound);
  const outboundBot = normalizeCount(row.outbound_bot);
  const outboundAgent = normalizeCount(row.outbound_agent);
  const outboundSystem = normalizeCount(row.outbound_system);
  return {
    dayAr: row.day_ar,
    inbound,
    outbound: normalizeCount(row.outbound),
    outboundBot,
    outboundAgent,
    outboundSystem,
    /** Saliente WhatsApp app: bot + agent; excluye eventos `system` (no transporte WA). */
    whatsappOutbound: outboundBot + outboundAgent,
    uniqueConversations: normalizeCount(row.unique_conversations),
  };
}

export function mapDeliveryStatusRow(row) {
  return {
    dayAr: row.day_ar,
    status: String(row.status || '').toLowerCase(),
    sidCount: normalizeCount(row.sid_count),
  };
}

export function mapMetricsWindowRow(row) {
  if (!row) return null;
  return {
    startDayAr: row.start_day_ar,
    endDayAr: row.end_day_ar,
    startUtc: row.start_utc,
    endUtcExclusive: row.end_utc_exclusive,
    presentationTimeZone: ARGENTINA_PRESENTATION_TZ,
    storageTimeZone: 'UTC',
  };
}

/**
 * Métricas diarias persistidas en SQL (no usage Twilio). Conteos = filas de mensaje / filas de SID.
 * @param {{ days?: number, asOf?: Date }} options
 */
export async function getDailyWhatsAppMetricsForDayRange({ startDayAr, endDayAr, asOf = new Date() }) {
  if (!isConversationDbEnabled()) {
    throw new Error('Conversation database is not enabled');
  }
  if (!startDayAr || !endDayAr) {
    throw new Error('startDayAr and endDayAr are required');
  }
  const [windowResult, dailyResult] = await Promise.all([
    query(RANGE_WINDOW_SQL, [startDayAr, endDayAr]),
    query(DAILY_MESSAGES_RANGE_SQL, [startDayAr, endDayAr]),
  ]);
  return {
    window: mapMetricsWindowRow(windowResult.rows[0]),
    days: null,
    asOfUtc: asOf.toISOString(),
    definitions: {
      messageRows:
        'COUNT de filas dbo.conversation_messages con join whatsapp/twilio; dedupe en insert por (provider, provider_message_id).',
      whatsappOutbound: 'outbound bot + agent; excluye sender_type system.',
    },
    templates: TEMPLATE_METRIC_LIMITATION,
    daily: dailyResult.rows.map(mapDailyMessageRow),
    deliveryByDay: [],
  };
}

export async function getDailyWhatsAppMetrics(options = {}) {
  if (!isConversationDbEnabled()) {
    throw new Error('Conversation database is not enabled');
  }
  const days = clampMetricsDays(options.days);
  const asOf = options.asOf instanceof Date ? options.asOf : new Date();

  const params = [asOf, days];
  const [windowResult, dailyResult, deliveryResult] = await Promise.all([
    query(WINDOW_SQL, params),
    query(DAILY_MESSAGES_SQL, params),
    query(DELIVERY_BY_DAY_SQL, params),
  ]);

  return {
    window: mapMetricsWindowRow(windowResult.rows[0]),
    days,
    asOfUtc: asOf.toISOString(),
    definitions: {
      messageRows:
        'COUNT de filas dbo.conversation_messages con join whatsapp/twilio; dedupe en insert por (provider, provider_message_id).',
      whatsappOutbound: 'outbound bot + agent; excluye sender_type system.',
      deliverySidCount:
        'COUNT de filas dbo.message_delivery_status (un SID Twilio real por PK); no incluye provider_message_id sintéticos TwiML (:outbound / out_*).',
      uniqueConversations: 'DISTINCT conversation_id con actividad ese día AR.',
    },
    templates: TEMPLATE_METRIC_LIMITATION,
    daily: dailyResult.rows.map(mapDailyMessageRow),
    deliveryByDay: deliveryResult.rows.map(mapDeliveryStatusRow),
  };
}

export default {
  ARGENTINA_PRESENTATION_TZ,
  TEMPLATE_METRIC_LIMITATION,
  clampMetricsDays,
  getDailyWhatsAppMetrics,
  getDailyWhatsAppMetricsForDayRange,
  isSyntheticTwilioOutboundProviderMessageId,
  mapDailyMessageRow,
  mapDeliveryStatusRow,
  mapMetricsWindowRow,
};