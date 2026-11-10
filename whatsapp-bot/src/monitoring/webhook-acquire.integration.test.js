import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { randomUUID } from 'crypto';
import '../config.js';
import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase, query, withTransaction } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import messagePersistence from '../services/message-persistence.service.js';
import { resetActivityForTests } from './activity-store.js';
import monitoringService from './monitoring.service.js';
import { beginInboundEvent, finishInboundEvent, twilioTurnOutboundId } from './webhook-events.service.js';
import { hasResponseBodyColumn, resetResponseBodyColumnCache } from './monitoring.repository.js';
import { withInboundLease } from './inbound-lease.js';
import auditLogService from '../services/audit-log.service.js';

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

async function deleteEvent(providerMessageId) {
  await query(
    'DELETE FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
    [providerMessageId],
  );
}

test('dos adquisiciones concurrentes del mismo MessageSid dejan un solo process', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
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
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
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
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
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
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
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
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
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
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
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
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
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

test('el worker anterior no cierra el evento que otro reclamó', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = `SM-FENCE-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
  });
  const first = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  await query(
    `UPDATE dbo.provider_webhook_events
     SET updated_at = DATEADD(minute, -10, SYSUTCDATETIME())
     WHERE id = $1`,
    [first.id],
  );
  const second = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  assert.equal(second.reason, 'reclaimed');
  const stale = await finishInboundEvent(first, null, undefined, '<Response>viejo</Response>');
  assert.equal(stale.owned, false);
  const owned = await finishInboundEvent(second, null, undefined, '<Response>nuevo</Response>');
  assert.equal(owned.owned, true);
  const { rows } = await query(
    `SELECT status, attempts FROM dbo.provider_webhook_events WHERE provider_message_id = $1`,
    [messageId],
  );
  assert.equal(rows[0].status, 'PROCESSED');
  assert.equal(Number(rows[0].attempts), 2);
});

test('el mismo provider_message_id no duplica el mensaje ni el handoff', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IDEM-${randomUUID()}`,
    phoneNumber: null,
    displayName: 'idempotencia',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: null,
  });
  const messageId = `SMIDEM${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const outboundId = twilioTurnOutboundId(messageId);
  t.after(async () => {
    await conversationRepository.deleteByIds([conversation.id]);
  });
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'bot',
    body: 'Menú exacto',
    provider: 'twilio',
    providerMessageId: outboundId,
    metadataJson: { event: 'reentry_prompt' },
  });
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'bot',
    body: 'no debe reemplazar',
    provider: 'twilio',
    providerMessageId: outboundId,
    metadataJson: { event: 'reentry_prompt' },
  });
  const stored = await query(
    `SELECT body FROM dbo.conversation_messages WHERE provider = N'twilio' AND provider_message_id = $1`,
    [outboundId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].body, 'Menú exacto');
  const replay = await messagePersistence.replayCommittedTurn({ messageId });
  assert.equal(replay.kind, 'reentry');
  assert.equal(replay.reply, 'Menú exacto');

  await withTransaction(async (transaction) => {
    const first = await humanHandoffRepository.ensurePendingHandoffAtomic(
      conversation.id,
      { requestedBy: 'bot', reason: 'human_handoff' },
      { transaction },
    );
    const second = await humanHandoffRepository.ensurePendingHandoffAtomic(
      conversation.id,
      { requestedBy: 'bot', reason: 'human_handoff' },
      { transaction },
    );
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.handoff.id, second.handoff.id);
  });
});

test('010 guarda el TwiML y un retry lo lee igual', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const migration = fs.readFileSync(
    new URL('../../migrations/010_webhook_response_body.sql', import.meta.url),
    'utf8',
  );
  const batches = migration
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim())
    .filter(Boolean);
  for (const batch of batches) {
    await query(batch);
  }
  resetResponseBodyColumnCache();
  assert.equal(await hasResponseBodyColumn(), true);
  const messageId = `SM-REPLAY-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
    resetResponseBodyColumnCache();
  });
  const gate = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId, NumMedia: '0' },
  });
  const twiml = '<Response><Message>Replay exacto</Message></Response>';
  const finished = await finishInboundEvent(gate, null, undefined, twiml);
  assert.equal(finished.owned, true);
  assert.equal(finished.replayStored, true);
  const again = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  assert.equal(again.action, 'skip');
  assert.equal(again.reason, 'processed');
  assert.equal(again.responseBody, twiml);
});

test('con monitoreo apagado el segundo begin no procesa de nuevo', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const previous = config.monitoringEnabled;
  config.monitoringEnabled = false;
  const messageId = `SM-FLAG-${randomUUID()}`;
  t.after(async () => {
    config.monitoringEnabled = previous;
    await deleteEvent(messageId);
  });
  const first = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  await finishInboundEvent(first, null, undefined, '<Response></Response>');
  const second = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  assert.equal(first.action, 'process');
  assert.equal(second.action, 'skip');
  assert.equal(second.reason, 'processed');
});

test('un MessageSid de 128 caracteres tiene outbound determinístico y un solo insert', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IDEM-LONG-${randomUUID()}`,
    phoneNumber: null,
    displayName: 'idempotencia larga',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: null,
  });
  const messageId = `L${'a'.repeat(127)}`;
  const outboundId = twilioTurnOutboundId(messageId);
  t.after(async () => {
    await conversationRepository.deleteByIds([conversation.id]);
  });
  assert.equal(outboundId, twilioTurnOutboundId(messageId));
  assert.ok(outboundId.length <= 128);
  assert.notEqual(outboundId, messageId);
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'bot',
    body: 'largo',
    provider: 'twilio',
    providerMessageId: outboundId,
  });
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'bot',
    body: 'reintento',
    provider: 'twilio',
    providerMessageId: outboundId,
  });
  const stored = await query(
    `SELECT body FROM dbo.conversation_messages WHERE provider = N'twilio' AND provider_message_id = $1`,
    [outboundId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].body, 'largo');
});

test('el worker que perdió el lease no inserta el mensaje', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IDEM-FENCE-${randomUUID()}`,
    phoneNumber: null,
    displayName: 'fence',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: null,
  });
  const messageId = `SM-LOST-${randomUUID()}`;
  t.after(async () => {
    await deleteEvent(messageId);
    await conversationRepository.deleteByIds([conversation.id]);
  });
  const first = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  await query(
    `UPDATE dbo.provider_webhook_events
     SET updated_at = DATEADD(minute, -10, SYSUTCDATETIME())
     WHERE id = $1`,
    [first.id],
  );
  const second = await beginInboundEvent({
    event: { provider: 'twilio', messageId },
    payload: { MessageSid: messageId },
  });
  assert.equal(second.reason, 'reclaimed');
  await assert.rejects(
    () => withInboundLease(
      { id: first.id, attempts: first.attempts },
      () => conversationMessageRepository.createMessage({
        conversationId: conversation.id,
        direction: 'inbound',
        senderType: 'user',
        body: 'no debe quedar',
        provider: 'twilio',
        providerMessageId: messageId,
      }),
    ),
    (error) => error.code === 'INBOUND_LEASE_LOST',
  );
  const stored = await query(
    `SELECT id FROM dbo.conversation_messages WHERE provider_message_id = $1`,
    [messageId],
  );
  assert.equal(stored.rows.length, 0);
  const stale = await finishInboundEvent(first, null, undefined, '<Response>viejo</Response>');
  assert.equal(stale.owned, false);
});

test('la misma auditoría por MessageSid se inserta una vez y otra acción se conserva', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const entityId = randomUUID();
  const providerMessageId = `SM-AUD-${randomUUID()}`;
  t.after(async () => {
    await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [entityId]);
  });
  await Promise.all([
    auditLogService.record({
      entityType: 'conversation',
      entityId,
      action: 'tb006.same_effect',
      metadata: { providerMessageId },
    }),
    auditLogService.record({
      entityType: 'conversation',
      entityId,
      action: 'tb006.same_effect',
      metadata: { providerMessageId },
    }),
  ]);
  await auditLogService.record({
    entityType: 'conversation',
    entityId,
    action: 'tb006.other_effect',
    metadata: { providerMessageId },
  });
  const same = await query(
    `SELECT COUNT(*) AS total
     FROM dbo.audit_logs
     WHERE entity_id = $1 AND action = N'tb006.same_effect'`,
    [entityId],
  );
  const other = await query(
    `SELECT COUNT(*) AS total
     FROM dbo.audit_logs
     WHERE entity_id = $1 AND action = N'tb006.other_effect'`,
    [entityId],
  );
  assert.equal(Number(same.rows[0].total), 1);
  assert.equal(Number(other.rows[0].total), 1);
});
