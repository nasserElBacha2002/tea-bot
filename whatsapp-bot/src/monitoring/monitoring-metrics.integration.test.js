/**
 * Métricas operativas DIN-430. Requiere base local aislada (tea-bot + TB_SQL_TEST_CONFIRM).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import {
  getOperationalSummary,
  getHandoffsMetrics,
  getSheetSyncMetrics,
} from './monitoring-metrics.service.js';

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
  return null;
}

async function cleanupHandoff(conversationId) {
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

test('getOperationalSummary responde con MONITORING_ENABLED desacoplado', async (t) => {
  const skip = await dbUnavailable();
  if (skip) {
    t.skip(skip);
    return;
  }
  const summary = await getOperationalSummary({ days: 7, asOf: new Date() });
  assert.equal(summary.available, true);
  assert.ok(summary.cards);
  assert.ok('messagesReceived' in summary.cards);
  assert.equal(typeof summary.monitoringEnabled, 'boolean');
});

test('handoffs metrics incluye pendientes sin PII', async (t) => {
  const skip = await dbUnavailable();
  if (skip) {
    t.skip(skip);
    return;
  }
  const conversationId = randomUUID();
  await query(
    `INSERT INTO dbo.conversations (id, channel, provider, external_user_id, status)
     VALUES ($1, N'whatsapp', N'twilio', $2, N'waiting_human')`,
    [conversationId, `metrics-handoff-${Date.now()}`],
  );
  await query(
    `INSERT INTO dbo.human_handoffs (conversation_id, requested_by, status, reason)
     VALUES ($1, N'user', N'pending', N'metrics-test')`,
    [conversationId],
  );
  t.after(async () => {
    await cleanupHandoff(conversationId);
  });
  const metrics = await getHandoffsMetrics({ days: 1, asOf: new Date() });
  assert.equal(metrics.available, true);
  assert.ok((metrics.current.pending ?? 0) >= 1);
  assert.equal(JSON.stringify(metrics).includes(conversationId), false);
});

test('sheet sync snapshot no requiere MONITORING_ENABLED', async (t) => {
  const skip = await dbUnavailable();
  if (skip) {
    t.skip(skip);
    return;
  }
  const snapshot = await getSheetSyncMetrics();
  assert.ok(snapshot.sheetSync);
  assert.equal(typeof snapshot.monitoringEnabled, 'boolean');
});