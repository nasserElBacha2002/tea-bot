import { query } from '../db/index.js';

function isUniqueViolation(error) {
  const number = error?.number || error?.originalError?.info?.number;
  return number === 2627 || number === 2601;
}

function mapWebhook(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    providerMessageId: row.provider_message_id,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    status: row.status,
    attempts: Number(row.attempts || 0),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
    responseBody: row.response_body == null ? null : String(row.response_body),
  };
}

let responseBodyColumnReady = false;
let responseBodyAbsenceLogged = false;

/**
 * NVARCHAR(MAX) hace que COL_LENGTH y max_length devuelvan -1.
 * La columna existe cuando el valor no es null. Comparar con > 0 la esconde.
 */
export function responseBodyColumnPresent(columnLength) {
  if (columnLength == null || columnLength === '') return false;
  return Number.isFinite(Number(columnLength));
}

export function resetResponseBodyColumnCache() {
  responseBodyColumnReady = false;
  responseBodyAbsenceLogged = false;
}

/** Un positivo se cachea. Un negativo no: aplicar 010 sin reiniciar debe verse. */
export async function hasResponseBodyColumn(dbQuery = query) {
  if (responseBodyColumnReady) return true;
  const { rows } = await dbQuery(
    `SELECT c.max_length AS column_length
     FROM sys.columns c
     WHERE c.object_id = OBJECT_ID(N'dbo.provider_webhook_events')
       AND c.name = N'response_body'`,
  );
  if (responseBodyColumnPresent(rows[0]?.column_length)) {
    responseBodyColumnReady = true;
    return true;
  }
  if (!responseBodyAbsenceLogged) {
    responseBodyAbsenceLogged = true;
    console.log(JSON.stringify({
      event: 'inbound_schema_warning',
      reason: 'response_body_missing',
      provider: 'twilio',
      messageId: null,
      flowId: null,
      attempts: null,
      httpStatus: null,
    }));
  }
  return false;
}

export async function findWebhookEvent(provider, eventType, providerMessageId) {
  const { rows } = await query(
    `SELECT TOP (1) * FROM dbo.provider_webhook_events
     WHERE provider = $1 AND event_type = $2 AND provider_message_id = $3`,
    [provider, eventType, providerMessageId],
  );
  return mapWebhook(rows[0]);
}

export async function insertWebhookEvent(row) {
  try {
    const { rows } = await query(
      `INSERT INTO dbo.provider_webhook_events (
        provider, event_type, provider_message_id, status, attempts, payload_json
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        row.provider,
        row.eventType,
        row.providerMessageId,
        row.status,
        row.attempts,
        row.payloadJson,
      ],
    );
    return { inserted: true, row: mapWebhook(rows[0]) };
  } catch (error) {
    if (!isUniqueViolation(error) || !row.providerMessageId) throw error;
    const existing = await findWebhookEvent(row.provider, row.eventType, row.providerMessageId);
    return { inserted: false, row: existing };
  }
}

/**
 * One owner for (provider, event_type, provider_message_id).
 * Insert wins the new event. Otherwise a conditional UPDATE ... OUTPUT is the
 * only way to move RECEIVED, FAILED, or a stale PROCESSING row to PROCESSING.
 * Zero rows means this caller did not acquire the message.
 */
export async function acquireInboundProcessing({
  provider,
  eventType,
  providerMessageId,
  payloadJson,
  maxAttempts,
  staleBefore,
}) {
  try {
    const { rows } = await query(
      `INSERT INTO dbo.provider_webhook_events (
        provider, event_type, provider_message_id, status, attempts, payload_json
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, N'PROCESSING', 1, $4)`,
      [provider, eventType, providerMessageId, payloadJson],
    );
    return { acquired: true, row: mapWebhook(rows[0]), reason: 'acquired' };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const claimed = await query(
    `UPDATE dbo.provider_webhook_events
     SET status = N'PROCESSING',
         attempts = CASE WHEN status = N'RECEIVED' THEN attempts ELSE attempts + 1 END,
         updated_at = SYSUTCDATETIME(),
         error_code = NULL,
         error_message = NULL
     OUTPUT INSERTED.*, DELETED.status AS previous_status
     WHERE provider = $1
       AND event_type = $2
       AND provider_message_id = $3
       AND (
         (status = N'RECEIVED' AND attempts <= $4)
         OR (status = N'FAILED' AND attempts < $4)
         OR (status = N'PROCESSING' AND updated_at < $5 AND attempts < $4)
       )`,
    [provider, eventType, providerMessageId, maxAttempts, staleBefore],
  );
  if (claimed.rows[0]) {
    const previousStatus = claimed.rows[0].previous_status;
    let reason = 'acquired';
    if (previousStatus === 'PROCESSING') reason = 'reclaimed';
    else if (previousStatus === 'FAILED') reason = 'retry';
    return { acquired: true, row: mapWebhook(claimed.rows[0]), reason };
  }

  const exhausted = await query(
    `UPDATE dbo.provider_webhook_events
     SET status = N'DEAD_LETTER',
         updated_at = SYSUTCDATETIME(),
         error_message = COALESCE(NULLIF(error_message, N''), N'max_attempts')
     OUTPUT INSERTED.*
     WHERE provider = $1
       AND event_type = $2
       AND provider_message_id = $3
       AND attempts >= $4
       AND (
         status IN (N'FAILED', N'RECEIVED')
         OR (status = N'PROCESSING' AND updated_at < $5)
       )`,
    [provider, eventType, providerMessageId, maxAttempts, staleBefore],
  );
  const row = mapWebhook(exhausted.rows[0])
    || await findWebhookEvent(provider, eventType, providerMessageId);
  if (!row) {
    throw new Error('webhook event disappeared after unique violation');
  }
  let reason = 'in_flight';
  if (row.status === 'PROCESSED') reason = 'processed';
  else if (row.status === 'DEAD_LETTER') reason = 'dead_letter';
  return { acquired: false, row, reason };
}

/**
 * Solo el dueño del lease cierra la fila. attempts es la generación:
 * un worker reclamado deja de coincidir y no pisa el resultado del nuevo dueño.
 * response_body (migración 010) guarda el TwiML para replay. Si la columna
 * no está, el cierre igual ocurre y el replay queda vacío.
 */
export async function markWebhookProcessed(id, { attempts, responseBody = null } = {}, dbQuery = query) {
  const storeResponse = await hasResponseBodyColumn(dbQuery);
  const params = [id, Number(attempts)];
  let responseSql = '';
  if (storeResponse) {
    responseSql = ', response_body = $3';
    params.push(responseBody);
  }
  const { rows } = await dbQuery(
    `UPDATE dbo.provider_webhook_events
     SET status = N'PROCESSED',
         processed_at = SYSUTCDATETIME(),
         updated_at = SYSUTCDATETIME(),
         error_code = NULL,
         error_message = NULL
         ${responseSql}
     OUTPUT INSERTED.id
     WHERE id = $1
       AND status = N'PROCESSING'
       AND attempts = $2`,
    params,
  );
  return { owned: Boolean(rows[0]), replayStored: storeResponse };
}

export async function markWebhookFailed(id, { status, errorCode, errorMessage, attempts }) {
  const { rows } = await query(
    `UPDATE dbo.provider_webhook_events
     SET status = $2,
         processed_at = SYSUTCDATETIME(),
         updated_at = SYSUTCDATETIME(),
         error_code = $3,
         error_message = $4
     OUTPUT INSERTED.id
     WHERE id = $1
       AND status = N'PROCESSING'
       AND attempts = $5`,
    [id, status, errorCode, errorMessage, Number(attempts)],
  );
  return { owned: Boolean(rows[0]) };
}

/**
 * Un DEAD_LETTER no se borra. El reintento manual baja attempts en uno
 * y vuelve a FAILED para que el próximo acquire pueda tomarlo una sola vez.
 * El error_code y el error_message quedan.
 */
export async function requeueDeadLetter(id, dbQuery = query) {
  const { rows } = await dbQuery(
    `UPDATE dbo.provider_webhook_events
     SET status = N'FAILED',
         attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
         updated_at = SYSUTCDATETIME()
     OUTPUT INSERTED.id,
            INSERTED.provider_message_id,
            INSERTED.attempts,
            INSERTED.error_code,
            INSERTED.error_message,
            INSERTED.status
     WHERE id = $1
       AND status = N'DEAD_LETTER'`,
    [id],
  );
  if (!rows[0]) return { requeued: false };
  return {
    requeued: true,
    id: rows[0].id,
    providerMessageId: rows[0].provider_message_id,
    attempts: Number(rows[0].attempts || 0),
    errorCode: rows[0].error_code || null,
    errorMessage: rows[0].error_message || null,
    status: rows[0].status,
  };
}

export async function listDeadLetterWebhookEvents(limit = 50, dbQuery = query) {
  const { rows } = await dbQuery(
    `SELECT TOP ($1)
       id, provider, event_type, provider_message_id, received_at, processed_at,
       status, attempts, error_code, error_message
     FROM dbo.provider_webhook_events
     WHERE status = N'DEAD_LETTER'
     ORDER BY received_at DESC`,
    [limit],
  );
  return rows.map(mapWebhook);
}

export async function listFailedWebhookEvents(limit = 50) {
  const { rows } = await query(
    `SELECT TOP ($1)
       id, provider, event_type, provider_message_id, received_at, processed_at,
       status, attempts, error_code, error_message
     FROM dbo.provider_webhook_events
     WHERE status IN (N'FAILED', N'DEAD_LETTER')
     ORDER BY received_at DESC`,
    [limit],
  );
  return rows.map(mapWebhook);
}

export async function countProcessedWebhooksSince(since) {
  const { rows } = await query(
    `SELECT
       SUM(CASE WHEN received_at >= $1 AND status = N'PROCESSED' THEN 1 ELSE 0 END) AS m15,
       SUM(CASE WHEN received_at >= $2 AND status = N'PROCESSED' THEN 1 ELSE 0 END) AS m60,
       SUM(CASE WHEN status = N'PROCESSED' THEN 1 ELSE 0 END) AS h24
     FROM dbo.provider_webhook_events
     WHERE received_at >= $3`,
    [since.m15, since.m60, since.h24],
  );
  const row = rows[0] || {};
  return {
    last15m: Number(row.m15 || 0),
    last60m: Number(row.m60 || 0),
    last24h: Number(row.h24 || 0),
  };
}

export async function countMessagesSince(since) {
  const { rows } = await query(
    `SELECT
       SUM(CASE WHEN created_at >= $1 AND direction = N'inbound' THEN 1 ELSE 0 END) AS in15,
       SUM(CASE WHEN created_at >= $1 AND direction = N'outbound' THEN 1 ELSE 0 END) AS out15,
       SUM(CASE WHEN created_at >= $2 AND direction = N'inbound' THEN 1 ELSE 0 END) AS in60,
       SUM(CASE WHEN created_at >= $2 AND direction = N'outbound' THEN 1 ELSE 0 END) AS out60,
       SUM(CASE WHEN direction = N'inbound' THEN 1 ELSE 0 END) AS in24,
       SUM(CASE WHEN direction = N'outbound' THEN 1 ELSE 0 END) AS out24
     FROM dbo.conversation_messages
     WHERE created_at >= $3`,
    [since.m15, since.m60, since.h24],
  );
  const row = rows[0] || {};
  return {
    last15m: { inbound: Number(row.in15 || 0), outbound: Number(row.out15 || 0) },
    last60m: { inbound: Number(row.in60 || 0), outbound: Number(row.out60 || 0) },
    last24h: { inbound: Number(row.in24 || 0), outbound: Number(row.out24 || 0) },
  };
}

export async function countInboundBetween(start, end) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total
     FROM dbo.conversation_messages
     WHERE direction = N'inbound' AND created_at >= $1 AND created_at < $2`,
    [start, end],
  );
  return Number(rows[0]?.total || 0);
}

export async function listPersistedTwilioSids(since) {
  const messages = await query(
    `SELECT provider_message_id
     FROM dbo.conversation_messages
     WHERE provider = N'twilio'
       AND provider_message_id IS NOT NULL
       AND created_at >= $1`,
    [since],
  );
  const events = await query(
    `SELECT provider_message_id
     FROM dbo.provider_webhook_events
     WHERE provider = N'twilio'
       AND provider_message_id IS NOT NULL
       AND received_at >= $1`,
    [since],
  );
  return [
    ...messages.rows.map((row) => row.provider_message_id),
    ...events.rows.map((row) => row.provider_message_id),
  ];
}

export async function getDeliveryStatus(provider, providerMessageId) {
  const { rows } = await query(
    `SELECT status FROM dbo.message_delivery_status
     WHERE provider = $1 AND provider_message_id = $2`,
    [provider, providerMessageId],
  );
  return rows[0]?.status || null;
}

export async function upsertDeliveryStatus(row) {
  const existing = await getDeliveryStatus(row.provider, row.providerMessageId);
  if (!existing) {
    await query(
      `INSERT INTO dbo.message_delivery_status (
        provider, provider_message_id, status, error_code, error_message, status_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, SYSUTCDATETIME())`,
      [row.provider, row.providerMessageId, row.status, row.errorCode, row.errorMessage, row.statusAt],
    );
    return { applied: true, previous: null };
  }
  await query(
    `UPDATE dbo.message_delivery_status
     SET status = $3, error_code = $4, error_message = $5, status_at = $6, updated_at = SYSUTCDATETIME()
     WHERE provider = $1 AND provider_message_id = $2`,
    [row.provider, row.providerMessageId, row.status, row.errorCode, row.errorMessage, row.statusAt],
  );
  return { applied: true, previous: existing };
}

export async function deliveryWindowCounts(since) {
  const { rows } = await query(
    `SELECT
       SUM(CASE WHEN updated_at >= $1 AND status = N'failed' THEN 1 ELSE 0 END) AS failed15,
       SUM(CASE WHEN updated_at >= $1 AND status = N'delivered' THEN 1 ELSE 0 END) AS delivered15,
       SUM(CASE WHEN updated_at >= $1 AND status = N'read' THEN 1 ELSE 0 END) AS read15,
       SUM(CASE WHEN updated_at >= $2 AND status = N'failed' THEN 1 ELSE 0 END) AS failed60,
       SUM(CASE WHEN updated_at >= $2 AND status = N'delivered' THEN 1 ELSE 0 END) AS delivered60,
       SUM(CASE WHEN updated_at >= $2 AND status = N'read' THEN 1 ELSE 0 END) AS read60,
       SUM(CASE WHEN status = N'failed' THEN 1 ELSE 0 END) AS failed24,
       SUM(CASE WHEN status = N'delivered' THEN 1 ELSE 0 END) AS delivered24,
       SUM(CASE WHEN status = N'read' THEN 1 ELSE 0 END) AS read24
     FROM dbo.message_delivery_status
     WHERE updated_at >= $3`,
    [since.m15, since.m60, since.h24],
  );
  const row = rows[0] || {};
  return {
    last15m: { failed: Number(row.failed15 || 0), delivered: Number(row.delivered15 || 0), read: Number(row.read15 || 0) },
    last60m: { failed: Number(row.failed60 || 0), delivered: Number(row.delivered60 || 0), read: Number(row.read60 || 0) },
    last24h: { failed: Number(row.failed24 || 0), delivered: Number(row.delivered24 || 0), read: Number(row.read24 || 0) },
  };
}

export async function topDeliveryErrorCodes(since, limit = 5) {
  const { rows } = await query(
    `SELECT TOP ($2) error_code, COUNT(*) AS total
     FROM dbo.message_delivery_status
     WHERE status IN (N'failed', N'undelivered')
       AND error_code IS NOT NULL
       AND updated_at >= $1
     GROUP BY error_code
     ORDER BY COUNT(*) DESC`,
    [since, limit],
  );
  return rows.map((row) => ({ code: row.error_code, count: Number(row.total || 0) }));
}

export async function upsertJobStatus(jobName, fields) {
  const details = JSON.stringify({
    lastDeletedCount: fields.lastDeletedCount ?? null,
    lastRuntimeCleanupFailed: fields.lastRuntimeCleanupFailed ?? null,
    lastDurationMs: fields.lastDurationMs ?? null,
  });
  const params = [
    jobName,
    fields.lastStartedAt || null,
    fields.lastFinishedAt || null,
    fields.lastStatus || null,
    fields.lastError ? String(fields.lastError).slice(0, 400) : null,
    details,
  ];
  const { rows } = await query(
    `UPDATE dbo.monitoring_job_status
     SET last_started_at = $2,
         last_finished_at = $3,
         last_status = $4,
         last_error = $5,
         details_json = $6,
         updated_at = SYSUTCDATETIME()
     OUTPUT INSERTED.job_name
     WHERE job_name = $1`,
    params,
  );
  if (rows.length > 0) return;
  await query(
    `INSERT INTO dbo.monitoring_job_status (
      job_name, last_started_at, last_finished_at, last_status, last_error, details_json
    )
    VALUES ($1, $2, $3, $4, $5, $6)`,
    params,
  );
}

export async function readJobStatus(jobName) {
  const { rows } = await query(
    `SELECT * FROM dbo.monitoring_job_status WHERE job_name = $1`,
    [jobName],
  );
  const row = rows[0];
  if (!row) return null;
  let details = {};
  try {
    details = row.details_json ? JSON.parse(row.details_json) : {};
  } catch {
    details = {};
  }
  return {
    lastStartedAt: row.last_started_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastDeletedCount: details.lastDeletedCount ?? null,
    lastRuntimeCleanupFailed: details.lastRuntimeCleanupFailed ?? null,
    lastDurationMs: details.lastDurationMs ?? null,
  };
}

export async function insertBalanceSample(balance, currency, checkedAt) {
  await query(
    `INSERT INTO dbo.monitoring_balance_samples (checked_at, balance_usd, currency)
     VALUES ($1, $2, $3)`,
    [checkedAt, balance, currency || 'USD'],
  );
}

export async function listBalanceSamples(since) {
  const { rows } = await query(
    `SELECT checked_at, balance_usd
     FROM dbo.monitoring_balance_samples
     WHERE checked_at >= $1
     ORDER BY checked_at ASC`,
    [since],
  );
  return rows.map((row) => ({
    checkedAt: row.checked_at,
    balance: Number(row.balance_usd),
  }));
}

export async function findOpenIncident(type) {
  const { rows } = await query(
    `SELECT TOP (1) id, type, status FROM dbo.monitoring_incidents
     WHERE type = $1 AND status = N'OPEN'
     ORDER BY started_at DESC`,
    [type],
  );
  return rows[0] || null;
}

export async function openIncident({ type, severity, summary, details }) {
  const existing = await findOpenIncident(type);
  if (existing) return { created: false, id: existing.id };
  const { rows } = await query(
    `INSERT INTO dbo.monitoring_incidents (type, severity, status, summary, details_json)
     OUTPUT INSERTED.id
     VALUES ($1, $2, N'OPEN', $3, $4)`,
    [type, severity, summary.slice(0, 400), JSON.stringify(details || {})],
  );
  return { created: true, id: rows[0]?.id || null };
}

export async function resolveOpenIncidents(type) {
  await query(
    `UPDATE dbo.monitoring_incidents
     SET status = N'RESOLVED', resolved_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME()
     WHERE type = $1 AND status = N'OPEN'`,
    [type],
  );
}

export async function listRecentIncidents(limit = 20) {
  const { rows } = await query(
    `SELECT TOP ($1)
       id, type, severity, status, started_at, resolved_at, summary
     FROM dbo.monitoring_incidents
     ORDER BY started_at DESC`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    summary: row.summary,
  }));
}

export async function readLatestActivity() {
  const { rows } = await query(
    `SELECT
       (SELECT MAX(created_at) FROM dbo.conversation_messages WHERE direction = N'inbound') AS last_inbound_at,
       (SELECT MAX(created_at) FROM dbo.conversation_messages WHERE direction = N'outbound') AS last_outbound_at,
       (SELECT MAX(processed_at) FROM dbo.provider_webhook_events WHERE status = N'PROCESSED') AS last_processed_at`,
  );
  const row = rows[0] || {};
  return {
    ok: true,
    lastInboundAt: row.last_inbound_at || null,
    lastOutboundAt: row.last_outbound_at || null,
    lastProcessedAt: row.last_processed_at || null,
  };
}
