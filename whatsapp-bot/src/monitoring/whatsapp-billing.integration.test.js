/**
 * Persistencia DIN-430 / migración 017. Requiere tea-bot local.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import { getWhatsAppBillingDashboard, billingDailyToCsv } from './whatsapp-billing-dashboard.service.js';
import { getWhatsAppCostAudit } from './whatsapp-cost-audit.service.js';
import { listBillingDailyAggregates } from './whatsapp-billing.repository.js';
import { resolveEffectiveBillingPeriod } from './whatsapp-effective-period.js';

async function dbUnavailable() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const table = await query(`SELECT OBJECT_ID(N'dbo.monitoring_billing_daily_aggregates', N'U') AS id`);
  if (!table.rows[0]?.id) return 'migration_017_not_applied';
  return null;
}

async function arMidnightUtc(arDateString) {
  const { rows: converted } = await query(
    `SELECT CAST(CAST($1 AS datetime2) AT TIME ZONE N'Argentina Standard Time' AT TIME ZONE 'UTC' AS datetime2) AS utc_at`,
    [`${arDateString} 00:00:00`],
  );
  return converted[0].utc_at;
}

async function deleteConversation(conversationId) {
  await query('DELETE FROM dbo.conversation_operation_requests WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [String(conversationId)]);
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

test('persiste agregados desde SQL, sobreviven retención de mensajes y son idempotentes', async (t) => {
  const skip = await dbUnavailable();
  if (skip) {
    t.skip(skip);
    return;
  }

  const { rows: anchorRows } = await query(
    `SELECT CONVERT(varchar(10), CAST(GETUTCDATE() AT TIME ZONE 'UTC' AT TIME ZONE N'Argentina Standard Time' AS date), 23) AS day_ar`,
  );
  const dayAr = anchorRows[0]?.day_ar;
  if (!dayAr) {
    t.skip('No se pudo resolver día Argentina');
    return;
  }
  const conversationId = randomUUID();
  const externalUser = `billing-retention-${Date.now()}`;
  const createdAt = await arMidnightUtc(dayAr);

  await query(
    `DELETE FROM dbo.monitoring_billing_daily_aggregates WHERE day_ar = $1`,
    [dayAr],
  );

  await query(
    `INSERT INTO dbo.conversations (id, channel, provider, external_user_id, status)
     VALUES ($1, N'whatsapp', N'twilio', $2, N'active')`,
    [conversationId, externalUser],
  );
  await query(
    `INSERT INTO dbo.conversation_messages (
      conversation_id, direction, sender_type, body, provider, provider_message_id, created_at
    )
    VALUES ($1, N'inbound', N'user', N'billing-in-1', N'twilio', $2, $3),
           ($1, N'outbound', N'bot', N'billing-out-1', N'twilio', $4, $5),
           ($1, N'outbound', N'bot', N'billing-out-2', N'twilio', $6, $7)`,
    [
      conversationId,
      `SMIN${Date.now()}`,
      createdAt,
      `SMOUT1${Date.now()}`,
      createdAt,
      `SMOUT2${Date.now()}`,
      createdAt,
    ],
  );

  t.after(async () => {
    await query('DELETE FROM dbo.monitoring_billing_daily_aggregates WHERE day_ar = $1', [dayAr]);
    await deleteConversation(conversationId);
  });

  const period = resolveEffectiveBillingPeriod(
    { period: 'custom', startDay: dayAr, endDay: dayAr },
    new Date(),
  );
  assert.equal(period.ok, true);

  const dashboard = await getWhatsAppBillingDashboard({
    days: period.days,
    asOf: period.asOf,
    period: period.period,
    fetchUsage: false,
    persistAggregates: true,
    effectiveWindow: period.window,
  });

  const row = dashboard.table.daily.find((entry) => entry.dayAr === dayAr);
  assert.ok(row);
  assert.equal(row.inbound, 1);
  assert.equal(row.outbound, 2);
  assert.ok(row.totalEstimatedUsd != null && row.totalEstimatedUsd > 0);

  const beforeDelete = await listBillingDailyAggregates(dayAr, dayAr);
  const storedBefore = beforeDelete.rows.find((entry) => entry.dayAr === dayAr);
  assert.ok(storedBefore);
  const expectedTotal = storedBefore.totalEstimatedUsd;

  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);

  const afterDelete = await listBillingDailyAggregates(dayAr, dayAr);
  const storedAfter = afterDelete.rows.find((entry) => entry.dayAr === dayAr);
  assert.ok(storedAfter);
  assert.equal(storedAfter.outbound, 2);
  assert.equal(storedAfter.totalEstimatedUsd, expectedTotal);

  const dashboardAfterRetention = await getWhatsAppBillingDashboard({
    days: period.days,
    asOf: period.asOf,
    period: period.period,
    fetchUsage: false,
    persistAggregates: false,
    effectiveWindow: period.window,
  });
  assert.equal(dashboardAfterRetention.indicators.messagesSent, 2);
  assert.ok(dashboardAfterRetention.indicators.knownSubtotalUsd != null
    || dashboardAfterRetention.indicators.totalCostUsd != null);

  const auditAfterRetention = await getWhatsAppCostAudit({
    days: period.days,
    asOf: period.asOf,
    fetchUsage: false,
    effectiveWindow: period.window,
  });
  const auditDay = (auditAfterRetention.messages?.daily || []).find((entry) => entry.dayAr === dayAr);
  assert.ok(auditDay);
  assert.equal(auditDay.inbound, 1);
  assert.equal(auditDay.whatsappOutbound, 2);

  const csv = billingDailyToCsv(dashboardAfterRetention.table.daily);
  assert.match(csv, new RegExp(String(expectedTotal)));
  const csvRow = dashboardAfterRetention.table.daily.find((entry) => entry.dayAr === dayAr);
  assert.equal(csvRow?.outbound, 2);
  assert.equal(csvRow?.totalEstimatedUsd, expectedTotal);

  await getWhatsAppBillingDashboard({
    days: period.days,
    asOf: period.asOf,
    period: period.period,
    fetchUsage: false,
    persistAggregates: false,
    effectiveWindow: period.window,
  });

  const { rows: dupCheck } = await query(
    `SELECT COUNT(*) AS c FROM dbo.monitoring_billing_daily_aggregates WHERE day_ar = $1`,
    [dayAr],
  );
  assert.equal(Number(dupCheck[0].c), 1);
});