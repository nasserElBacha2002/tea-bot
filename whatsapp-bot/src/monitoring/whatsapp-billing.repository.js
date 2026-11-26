import { query } from '../db/index.js';
import { ARGENTINA_PRESENTATION_TZ } from './whatsapp-daily-metrics.js';

/**
 * Proxy de mensajes service Meta: outbound bot+agent (whatsapp/twilio) desde inicio de mes AR hasta día exclusivo.
 */
export async function countWhatsappOutboundProxyMonthToDate(monthYm, beforeDayArExclusive) {
  if (!monthYm || !beforeDayArExclusive) {
    return { count: null, quality: 'unavailable' };
  }
  const monthStart = `${monthYm}-01`;
  const { rows } = await query(
    `SELECT COUNT(*) AS total
     FROM dbo.conversation_messages m
     INNER JOIN dbo.conversations c ON c.id = m.conversation_id
     WHERE c.channel = N'whatsapp'
       AND c.provider = N'twilio'
       AND m.direction = N'outbound'
       AND m.sender_type IN (N'bot', N'agent')
       AND m.created_at >=
         CAST(CAST($1 AS datetime2) AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS datetime2)
       AND m.created_at <
         CAST(CAST($2 AS datetime2) AT TIME ZONE N'${ARGENTINA_PRESENTATION_TZ}' AT TIME ZONE 'UTC' AS datetime2)`,
    [monthStart, beforeDayArExclusive],
  );
  return {
    count: Number(rows[0]?.total || 0),
    quality: 'sql_service_proxy',
    fromDayAr: monthStart,
    beforeDayArExclusive,
  };
}

export async function upsertBillingDailyAggregate(row) {
  const table = await query(`SELECT OBJECT_ID(N'dbo.monitoring_billing_daily_aggregates', N'U') AS id`);
  if (!table.rows[0]?.id) {
    return { persisted: false, reason: 'TABLE_NOT_PRESENT' };
  }
  await query(
    `MERGE dbo.monitoring_billing_daily_aggregates AS t
     USING (SELECT $1 AS day_ar) AS s
     ON t.day_ar = s.day_ar
     WHEN MATCHED AND (
       $2 > 0 OR $3 > 0 OR $10 IS NOT NULL OR t.total_estimated_usd IS NULL
     ) THEN
       UPDATE SET
         inbound_count = CASE WHEN $2 > 0 OR t.inbound_count IS NULL THEN $2 ELSE t.inbound_count END,
         outbound_count = CASE WHEN $3 > 0 OR t.outbound_count IS NULL THEN $3 ELSE t.outbound_count END,
         outbound_bot_count = CASE WHEN $4 > 0 OR t.outbound_bot_count IS NULL THEN $4 ELSE t.outbound_bot_count END,
         outbound_agent_count = CASE WHEN $5 > 0 OR t.outbound_agent_count IS NULL THEN $5 ELSE t.outbound_agent_count END,
         free_service_count = COALESCE($6, t.free_service_count),
         billable_service_count = COALESCE($7, t.billable_service_count),
         twilio_estimated_usd = COALESCE($8, t.twilio_estimated_usd),
         meta_estimated_usd = COALESCE($9, t.meta_estimated_usd),
         total_estimated_usd = COALESCE($10, t.total_estimated_usd),
         twilio_confirmed_usd = COALESCE($11, t.twilio_confirmed_usd),
         meta_confirmed_usd = COALESCE($12, t.meta_confirmed_usd),
         total_confirmed_usd = COALESCE($13, t.total_confirmed_usd),
         currency = $14,
         data_source = $15,
         reconciliation_status = $16,
         updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN
       INSERT (
         day_ar, inbound_count, outbound_count, outbound_bot_count, outbound_agent_count,
         free_service_count, billable_service_count,
         twilio_estimated_usd, meta_estimated_usd, total_estimated_usd,
         twilio_confirmed_usd, meta_confirmed_usd, total_confirmed_usd,
         currency, data_source, reconciliation_status
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
       );`,
    [
      row.dayAr,
      row.inbound ?? 0,
      row.whatsappOutbound ?? 0,
      row.outboundBot ?? 0,
      row.outboundAgent ?? 0,
      row.freeService ?? null,
      row.billableService ?? null,
      row.twilioEstimatedUsd,
      row.metaEstimatedUsd,
      row.totalEstimatedUsd,
      row.twilioConfirmedUsd,
      row.metaConfirmedUsd,
      row.totalConfirmedUsd,
      row.currency || 'USD',
      row.dataSource || 'estimated_sql',
      row.reconciliationStatus || 'pending',
    ],
  );
  return { persisted: true };
}

export async function listBillingDailyAggregates(startDayAr, endDayAr) {
  const table = await query(`SELECT OBJECT_ID(N'dbo.monitoring_billing_daily_aggregates', N'U') AS id`);
  if (!table.rows[0]?.id || !startDayAr || !endDayAr) {
    return { available: false, rows: [] };
  }
  const { rows } = await query(
    `SELECT day_ar, inbound_count, outbound_count, outbound_bot_count, outbound_agent_count,
            free_service_count, billable_service_count,
            twilio_estimated_usd, meta_estimated_usd, total_estimated_usd,
            twilio_confirmed_usd, meta_confirmed_usd, total_confirmed_usd,
            data_source, reconciliation_status, updated_at
     FROM dbo.monitoring_billing_daily_aggregates
     WHERE day_ar >= $1 AND day_ar <= $2
     ORDER BY day_ar`,
    [startDayAr, endDayAr],
  );
  return {
    available: true,
    rows: rows.map((row) => ({
      dayAr: row.day_ar,
      inbound: row.inbound_count,
      outbound: row.outbound_count,
      outboundBot: row.outbound_bot_count,
      outboundAgent: row.outbound_agent_count,
      freeService: row.free_service_count,
      billableService: row.billable_service_count,
      twilioEstimatedUsd: row.twilio_estimated_usd == null ? null : Number(row.twilio_estimated_usd),
      metaEstimatedUsd: row.meta_estimated_usd == null ? null : Number(row.meta_estimated_usd),
      totalEstimatedUsd: row.total_estimated_usd == null ? null : Number(row.total_estimated_usd),
      twilioConfirmedUsd: row.twilio_confirmed_usd == null ? null : Number(row.twilio_confirmed_usd),
      metaConfirmedUsd: row.meta_confirmed_usd == null ? null : Number(row.meta_confirmed_usd),
      totalConfirmedUsd: row.total_confirmed_usd == null ? null : Number(row.total_confirmed_usd),
      dataSource: row.data_source,
      reconciliationStatus: row.reconciliation_status,
      updatedAt: row.updated_at,
    })),
  };
}