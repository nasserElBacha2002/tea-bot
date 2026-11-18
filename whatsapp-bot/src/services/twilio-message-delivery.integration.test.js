import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import * as repository from '../monitoring/monitoring.repository.js';
import twilioMessageDeliveryService, {
  deliveryDeps,
  syncDeliveryAfterOutboundLink,
} from './twilio-message-delivery.service.js';
import agentOutboundSendService, {
  OUTBOUND_DELIVERY_STATES,
} from './agent-outbound-send.service.js';

async function skipReason() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const { rows } = await query(
    `SELECT OBJECT_ID(N'dbo.message_delivery_status', N'U') AS delivery_table`,
  );
  if (!rows[0]?.delivery_table) return 'message_delivery_status missing (migration 007)';
  return null;
}

async function cleanupDelivery(providerMessageId) {
  await query(
    'DELETE FROM dbo.message_delivery_status WHERE provider = N\'twilio\' AND provider_message_id = $1',
    [providerMessageId],
  );
}

async function cleanupConversation(conversationId) {
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

test('SQL: callbacks concurrentes no retroceden el estado final', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const sid = `SM-D439-C-${randomUUID()}`;
  t.after(async () => {
    await cleanupDelivery(sid);
  });

  const results = await Promise.all([
    twilioMessageDeliveryService.processStatusCallback({ MessageSid: sid, MessageStatus: 'delivered' }),
    twilioMessageDeliveryService.processStatusCallback({ MessageSid: sid, MessageStatus: 'sent' }),
    twilioMessageDeliveryService.processStatusCallback({ MessageSid: sid, MessageStatus: 'read' }),
    twilioMessageDeliveryService.processStatusCallback({ MessageSid: sid, MessageStatus: 'queued' }),
  ]);

  assert.equal(results.some((row) => row.applied), true);
  const row = await repository.getDeliveryStatusRow('twilio', sid);
  assert.equal(row?.status, 'read');
});

test('SQL: callback anterior a la vinculación se reconcilia al enlazar SID', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const sid = `SM-D439-EARLY-${randomUUID()}`;
  const suffix = Date.now();
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IT-DEL-${suffix}`,
    phoneNumber: '+5491100008888',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  t.after(async () => {
    await cleanupDelivery(sid);
    await cleanupConversation(conversation.id);
  });

  const early = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: sid,
    MessageStatus: 'delivered',
  });
  assert.equal(early.applied, true);
  assert.equal(early.notified, false);

  const message = await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'archivo',
    provider: 'twilio',
    providerMessageId: sid,
    metadataJson: {
      outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.CONFIRMED },
    },
  });

  const sync = await syncDeliveryAfterOutboundLink(message);
  assert.equal(sync.notified, true);
  const status = await repository.getDeliveryStatusRow('twilio', sid);
  assert.equal(status?.status, 'delivered');
});

test('SQL: lotes mantienen estado independiente por MessageSid', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const sidA = `SM-D439-BA-${randomUUID()}`;
  const sidB = `SM-D439-BB-${randomUUID()}`;
  const suffix = Date.now();
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IT-BATCH-${suffix}`,
    phoneNumber: '+5491100007777',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  t.after(async () => {
    await cleanupDelivery(sidA);
    await cleanupDelivery(sidB);
    await cleanupConversation(conversation.id);
  });

  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'a',
    provider: 'twilio',
    providerMessageId: sidA,
    metadataJson: { outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.CONFIRMED } },
  });
  await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'b',
    provider: 'twilio',
    providerMessageId: sidB,
    metadataJson: { outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.CONFIRMED } },
  });

  await twilioMessageDeliveryService.processStatusCallback({ MessageSid: sidA, MessageStatus: 'read' });
  await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: sidB,
    MessageStatus: 'failed',
    ErrorCode: '30008',
    ErrorMessage: 'Unknown error',
  });

  const rowA = await repository.getDeliveryStatusRow('twilio', sidA);
  const rowB = await repository.getDeliveryStatusRow('twilio', sidB);
  assert.equal(rowA?.status, 'read');
  assert.equal(rowB?.status, 'failed');
  assert.equal(rowB?.errorCode, '30008');
});

test('SQL: falla la notificación y el callback duplicado recupera sin regresar estado', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const sid = `SM-D439-NF-${randomUUID()}`;
  const suffix = Date.now();
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IT-NF-${suffix}`,
    phoneNumber: '+5491100006666',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  const message = await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'hola',
    provider: 'twilio',
    providerMessageId: sid,
    metadataJson: { outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.CONFIRMED } },
  });

  const savedNotify = deliveryDeps.notifyConversationMessageUpdated;
  let notifyAttempts = 0;
  t.after(async () => {
    deliveryDeps.notifyConversationMessageUpdated = savedNotify;
    await cleanupDelivery(sid);
    await cleanupConversation(conversation.id);
  });

  deliveryDeps.notifyConversationMessageUpdated = () => {
    notifyAttempts += 1;
    if (notifyAttempts === 1) throw new Error('ws down');
  };

  const first = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: sid,
    MessageStatus: 'delivered',
  });
  assert.equal(first.applied, true);
  assert.equal(first.notified, false);
  assert.equal((await repository.getDeliveryStatusRow('twilio', sid))?.status, 'delivered');

  deliveryDeps.notifyConversationMessageUpdated = () => {
    notifyAttempts += 1;
  };

  const second = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: sid,
    MessageStatus: 'delivered',
  });
  assert.equal(second.applied, false);
  assert.equal(second.notifyRecovered, true);
  assert.equal(second.notified, true);
  assert.equal(notifyAttempts, 2);
  assert.equal((await repository.getDeliveryStatusRow('twilio', sid))?.status, 'delivered');
});

test('SQL: finalización agente con Twilio simulado reconcilia callback temprano', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const sid = `SM-D439-AG-${randomUUID()}`;
  const suffix = Date.now();
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IT-AG-${suffix}`,
    phoneNumber: '+5491100005555',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  t.after(async () => {
    await cleanupDelivery(sid);
    await cleanupConversation(conversation.id);
  });

  await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: sid,
    MessageStatus: 'read',
  });

  const pending = await conversationMessageRepository.createMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'archivo',
    provider: 'twilio',
    providerMessageId: null,
    metadataJson: {
      clientRequestId: `req-${suffix}`,
      outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.PENDING },
    },
  });

  let published = 0;
  const savedNotify = deliveryDeps.notifyConversationMessageUpdated;
  deliveryDeps.notifyConversationMessageUpdated = () => {
    published += 1;
  };
  t.after(() => {
    deliveryDeps.notifyConversationMessageUpdated = savedNotify;
  });

  const prevTwilio = agentOutboundSendService._callTwilio;
  agentOutboundSendService._callTwilio = async () => sid;
  try {
    await agentOutboundSendService._finalizeDelivery(pending.id, {
      providerMessageId: sid,
      state: OUTBOUND_DELIVERY_STATES.CONFIRMED,
    });
  } finally {
    agentOutboundSendService._callTwilio = prevTwilio;
  }

  assert.equal(published >= 1, true);
  assert.equal((await repository.getDeliveryStatusRow('twilio', sid))?.status, 'read');
});