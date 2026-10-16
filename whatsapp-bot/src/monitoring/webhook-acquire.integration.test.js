import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import { resetActivityForTests } from './activity-store.js';
import monitoringService from './monitoring.service.js';
import { beginInboundEvent } from './webhook-events.service.js';

async function dbUnavailable() {
  if (!isConversationDbEnabled()) return true;
  try {
    const ping = await pingDatabase();
    return !ping.ok;
  } catch {
    return true;
  }
}

async function deleteEvent(providerMessageId) {
  await query(
    'DELETE FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
    [providerMessageId],
  );
}

test('dos adquisiciones concurrentes del mismo MessageSid dejan un solo process', async (t) => {
  if (await dbUnavailable()) {
    t.skip('SQL Server no disponible');
    return;
  }
  const messageId = `SM-ACQ-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
  });
  const [left, right] = await Promise.all([
    beginInboundEvent({ event: { provider: 'twilio', messageId }, payload: { MessageSid: messageId } }),
    beginInboundEvent({ event: { provider: 'twilio', messageId }, payload: { MessageSid: messageId } }),
  ]);
  const outcomes = [left.action, right.action].sort();
  assert.deepEqual(outcomes, ['process', 'skip']);
  const skipped = [left, right].find((item) => item.action === 'skip');
  assert.equal(skipped.reason, 'in_flight');
  const { rows } = await query(
    `SELECT status, attempts FROM dbo.provider_webhook_events WHERE provider_message_id = $1`,
    [messageId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'PROCESSING');
  assert.equal(Number(rows[0].attempts), 1);
});

test('PROCESSING reciente no se vuelve a adquirir', async (t) => {
  if (await dbUnavailable()) {
    t.skip('SQL Server no disponible');
    return;
  }
  const messageId = `SM-PROC-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
  });
  await query(
    `INSERT INTO dbo.provider_webhook_events (
      provider, event_type, provider_message_id, status, attempts, updated_at
    ) VALUES (N'twilio', N'inbound', $1, N'PROCESSING', 1, SYSUTCDATETIME())`,
    [messageId],
  );
  const gate = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  assert.equal(gate.action, 'skip');
  assert.equal(gate.reason, 'in_flight');
});

test('FAILED bajo el maximo lo adquiere un solo worker', async (t) => {
  if (await dbUnavailable()) {
    t.skip('SQL Server no disponible');
    return;
  }
  const messageId = `SM-FAIL-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
  });
  await query(
    `INSERT INTO dbo.provider_webhook_events (
      provider, event_type, provider_message_id, status, attempts, updated_at
    ) VALUES (N'twilio', N'inbound', $1, N'FAILED', 1, SYSUTCDATETIME())`,
    [messageId],
  );
  const [left, right] = await Promise.all([
    beginInboundEvent({ event: { provider: 'twilio', messageId }, payload: { MessageSid: messageId } }),
    beginInboundEvent({ event: { provider: 'twilio', messageId }, payload: { MessageSid: messageId } }),
  ]);
  const processes = [left, right].filter((item) => item.action === 'process');
  assert.equal(processes.length, 1);
  assert.equal(processes[0].attempts, 2);
  const { rows } = await query(
    `SELECT status, attempts FROM dbo.provider_webhook_events WHERE provider_message_id = $1`,
    [messageId],
  );
  assert.equal(rows[0].status, 'PROCESSING');
  assert.equal(Number(rows[0].attempts), 2);
});

test('FAILED en el maximo pasa a DEAD_LETTER y no procesa', async (t) => {
  if (await dbUnavailable()) {
    t.skip('SQL Server no disponible');
    return;
  }
  const messageId = `SM-DEAD-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
  });
  await query(
    `INSERT INTO dbo.provider_webhook_events (
      provider, event_type, provider_message_id, status, attempts, updated_at
    ) VALUES (N'twilio', N'inbound', $1, N'FAILED', 3, SYSUTCDATETIME())`,
    [messageId],
  );
  const gate = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  assert.equal(gate.action, 'skip');
  assert.equal(gate.reason, 'dead_letter');
  const { rows } = await query(
    `SELECT status FROM dbo.provider_webhook_events WHERE provider_message_id = $1`,
    [messageId],
  );
  assert.equal(rows[0].status, 'DEAD_LETTER');
});

test('PROCESSING stale se reclama de forma atomica', async (t) => {
  if (await dbUnavailable()) {
    t.skip('SQL Server no disponible');
    return;
  }
  const messageId = `SM-STALE-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
  });
  await query(
    `INSERT INTO dbo.provider_webhook_events (
      provider, event_type, provider_message_id, status, attempts, updated_at
    ) VALUES (N'twilio', N'inbound', $1, N'PROCESSING', 1, DATEADD(minute, -10, SYSUTCDATETIME()))`,
    [messageId],
  );
  const [left, right] = await Promise.all([
    beginInboundEvent({ event: { provider: 'twilio', messageId }, payload: { MessageSid: messageId } }),
    beginInboundEvent({ event: { provider: 'twilio', messageId }, payload: { MessageSid: messageId } }),
  ]);
  const processes = [left, right].filter((item) => item.action === 'process');
  assert.equal(processes.length, 1);
  assert.equal(processes[0].attempts, 2);
});

test('migracion 007 aplicada: tablas, indice unico, indice de actividad y constraints', async (t) => {
  if (await dbUnavailable()) {
    t.skip('SQL Server no disponible');
    return;
  }
  const tables = await query(
    `SELECT name FROM sys.tables
     WHERE name IN (
       N'provider_webhook_events',
       N'message_delivery_status',
       N'monitoring_incidents',
       N'monitoring_job_status',
       N'monitoring_balance_samples'
     )`,
  );
  assert.equal(tables.rows.length, 5);
  const updated = await query(
    `SELECT COL_LENGTH(N'dbo.provider_webhook_events', N'updated_at') AS len`,
  );
  assert.ok(Number(updated.rows[0].len) > 0);
  const unique = await query(
    `SELECT is_unique, has_filter FROM sys.indexes
     WHERE name = N'UQ_provider_webhook_events_message'`,
  );
  assert.equal(unique.rows[0].is_unique, true);
  assert.equal(unique.rows[0].has_filter, true);
  const activity = await query(
    `SELECT name FROM sys.indexes WHERE name = N'idx_conversation_messages_created_at_direction'`,
  );
  assert.equal(activity.rows.length, 1);
  const pk = await query(
    `SELECT name FROM sys.key_constraints
     WHERE name = N'PK_provider_webhook_events'`,
  );
  assert.equal(pk.rows.length, 1);

  const messageId = `SM-DUP-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
  });
  const insert = `INSERT INTO dbo.provider_webhook_events (
    provider, event_type, provider_message_id, status, attempts
  ) VALUES (N'twilio', N'inbound', $1, N'RECEIVED', 1)`;
  const settled = await Promise.allSettled([
    query(insert, [messageId]),
    query(insert, [messageId]),
  ]);
  const rejected = settled.filter((item) => item.status === 'rejected');
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(rejected.length, 1);
  const number = rejected[0].reason?.number || rejected[0].reason?.originalError?.info?.number;
  assert.ok(number === 2601 || number === 2627);
});

test('health recupera last inbound desde DB con el store vacio', async (t) => {
  if (await dbUnavailable()) {
    t.skip('SQL Server no disponible');
    return;
  }
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `ACT-${randomUUID()}`,
    phoneNumber: null,
    displayName: 'activity fallback',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: null,
  });
  t.after(async () => {
    await conversationRepository.deleteByIds([conversation.id]);
  });
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    senderType: 'user',
    body: 'hola',
    provider: 'internal',
  });
  resetActivityForTests();
  const expected = await query(
    `SELECT MAX(created_at) AS ts FROM dbo.conversation_messages WHERE direction = N'inbound'`,
  );
  const health = await monitoringService.getBotHealth();
  assert.equal(health.activity.activityPersistenceOk, true);
  assert.equal(
    new Date(health.activity.lastInboundAt).getTime(),
    new Date(expected.rows[0].ts).getTime(),
  );
});
