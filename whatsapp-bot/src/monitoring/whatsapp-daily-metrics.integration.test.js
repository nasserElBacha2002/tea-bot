/**
 * Métricas SQL diarias WhatsApp.
 * Requiere base aislada: tea-bot + TB_SQL_TEST_CONFIRM=tea-bot, o tea_bot_test_* + tea_bot_test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import { upsertDeliveryStatus } from './monitoring.repository.js';
import {
  getDailyWhatsAppMetrics,
  isSyntheticTwilioOutboundProviderMessageId,
} from './whatsapp-daily-metrics.js';

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

function phone() {
  return `+54911${String(Date.now()).slice(-8)}`;
}

async function deleteConversation(conversationId) {
  if (!conversationId) return;
  await query('DELETE FROM dbo.conversation_operation_requests WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [String(conversationId)]);
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

async function deleteDelivery(providerMessageId) {
  if (!providerMessageId) return;
  await query(
    'DELETE FROM dbo.message_delivery_status WHERE provider = N\'twilio\' AND provider_message_id = $1',
    [providerMessageId],
  );
}

async function insertMessageAt({
  conversationId,
  direction,
  senderType,
  providerMessageId = null,
  createdAt,
}) {
  await query(
    `INSERT INTO dbo.conversation_messages (
      conversation_id, direction, sender_type, body, provider,
      provider_message_id, created_at
    )
    VALUES ($1, $2, $3, N'wa-metrics-test', N'twilio', $4, $5)`,
    [conversationId, direction, senderType, providerMessageId, createdAt],
  );
}

async function arMidnightUtc(arDateString) {
  const { rows } = await query(
    `SELECT CAST($1 AS date) AS d`,
    [arDateString],
  );
  const d = rows[0].d;
  const { rows: converted } = await query(
    `SELECT CAST(CAST($1 AS datetime2) AT TIME ZONE N'Argentina Standard Time' AT TIME ZONE 'UTC' AS datetime2) AS utc_at`,
    [d],
  );
  return converted[0].utc_at;
}

test('conteos diarios clasifican inbound, outbound y excluyen system de whatsappOutbound', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }

  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `wa-metrics-${randomUUID()}`,
    phoneNumber: phone(),
  });
  t.after(async () => {
    await deleteConversation(conversation.id);
  });

  const dayAr = '2099-06-15';
  const noonUtc = await arMidnightUtc(dayAr);
  const createdAt = new Date(new Date(noonUtc).getTime() + 12 * 60 * 60 * 1000);

  await insertMessageAt({
    conversationId: conversation.id,
    direction: 'inbound',
    senderType: 'user',
    providerMessageId: `SM-429-IN-${randomUUID()}`,
    createdAt,
  });
  await insertMessageAt({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'bot',
    providerMessageId: `SM-429-IN-${randomUUID().slice(0, 8)}:outbound`,
    createdAt,
  });
  await insertMessageAt({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'agent',
    providerMessageId: `SM-429-AG-${randomUUID()}`,
    createdAt,
  });
  await insertMessageAt({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'system',
    createdAt,
  });

  const asOf = new Date(new Date(noonUtc).getTime() + 20 * 60 * 60 * 1000);
  const metrics = await getDailyWhatsAppMetrics({ days: 7, asOf });
  assert.equal(metrics.templates.available, false);

  const day = metrics.daily.find((row) => row.dayAr === dayAr);
  assert.ok(day, `fila esperada para ${dayAr}`);
  assert.equal(day.inbound, 1);
  assert.equal(day.outbound, 3);
  assert.equal(day.outboundBot, 1);
  assert.equal(day.outboundAgent, 1);
  assert.equal(day.outboundSystem, 1);
  assert.equal(day.whatsappOutbound, 2);
  assert.equal(day.uniqueConversations, 1);
});

test('insert duplicado por provider_message_id no duplica conteos', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }

  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `wa-metrics-dedup-${randomUUID()}`,
    phoneNumber: phone(),
  });
  const messageId = `SM-429-DEDUP-${randomUUID()}`;
  t.after(async () => {
    await deleteConversation(conversation.id);
  });

  const { rows: dayRows } = await query(
    `SELECT CONVERT(varchar(10),
       CAST((SYSUTCDATETIME() AT TIME ZONE 'UTC') AT TIME ZONE N'Argentina Standard Time' AS date),
       23) AS d`,
  );
  const dayAr = dayRows[0].d;

  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    senderType: 'user',
    body: 'uno',
    provider: 'twilio',
    providerMessageId: messageId,
  });
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    senderType: 'user',
    body: 'uno',
    provider: 'twilio',
    providerMessageId: messageId,
  });

  const metrics = await getDailyWhatsAppMetrics({ days: 3 });
  const day = metrics.daily.find((row) => row.dayAr === dayAr);
  assert.ok(day);
  assert.equal(day.inbound, 1);
});

test('mensaje fuera de la ventana de 30 días AR no se cuenta', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }

  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `wa-metrics-old-${randomUUID()}`,
    phoneNumber: phone(),
  });
  t.after(async () => {
    await deleteConversation(conversation.id);
  });

  const oldDay = '2088-01-10';
  const oldUtc = await arMidnightUtc(oldDay);
  await insertMessageAt({
    conversationId: conversation.id,
    direction: 'inbound',
    senderType: 'user',
    providerMessageId: `SM-429-OLD-${randomUUID()}`,
    createdAt: new Date(new Date(oldUtc).getTime() + 3600000),
  });

  const metrics = await getDailyWhatsAppMetrics({ days: 30, asOf: new Date('2099-01-01T15:00:00.000Z') });
  const hit = metrics.daily.find((row) => row.dayAr === oldDay);
  assert.equal(hit, undefined);
  assert.ok(metrics.window.startDayAr < metrics.window.endDayAr);
});

test('message_delivery_status cuenta un SID por estado pese a updates', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }

  const sid = `SM-429-DEL-${randomUUID()}`;
  const dayAr = '2099-08-01';
  const statusAt = await arMidnightUtc(dayAr);
  const at = new Date(new Date(statusAt).getTime() + 8 * 60 * 60 * 1000);

  t.after(async () => {
    await deleteDelivery(sid);
  });

  await upsertDeliveryStatus({
    provider: 'twilio',
    providerMessageId: sid,
    status: 'sent',
    errorCode: null,
    errorMessage: null,
    statusAt: at,
  });
  await upsertDeliveryStatus({
    provider: 'twilio',
    providerMessageId: sid,
    status: 'delivered',
    errorCode: null,
    errorMessage: null,
    statusAt: new Date(at.getTime() + 60000),
  });

  const asOf = new Date(at.getTime() + 12 * 60 * 60 * 1000);
  const metrics = await getDailyWhatsAppMetrics({ days: 5, asOf });
  const rows = metrics.deliveryByDay.filter((row) => row.dayAr === dayAr);
  const delivered = rows.find((row) => row.status === 'delivered');
  assert.ok(delivered);
  assert.equal(delivered.sidCount, 1);
  assert.equal(rows.reduce((sum, row) => sum + row.sidCount, 0), 1);
});

test('métricas documentan que delivery no mezcla SIDs TwiML sintéticos', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const synthetic = `SM-429-SYN-${randomUUID().slice(0, 6)}:outbound`;
  assert.equal(isSyntheticTwilioOutboundProviderMessageId(synthetic), true);
  const metrics = await getDailyWhatsAppMetrics({ days: 1 });
  assert.match(metrics.definitions.deliverySidCount, /:outbound/);
  assert.equal(metrics.templates.available, false);
});