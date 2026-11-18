import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import agentOutboundSendService, {
  OUTBOUND_DELIVERY_STATES,
  hashAgentSendPayload,
} from './agent-outbound-send.service.js';
import { expireStaleOutboundDispatchLeases, tryAcquireOutboundDispatchLease } from './agent-outbound-send.service.js';

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
    `SELECT OBJECT_ID(N'dbo.conversation_operation_requests', N'U') AS operation_table`,
  );
  if (!rows[0]?.operation_table) return 'conversation_operation_requests missing (migration 009)';
  return null;
}

async function cleanupConversation(conversationId) {
  await query('DELETE FROM dbo.conversation_message_attachments WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_operation_requests WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

function ctxFor(conversation, agentId) {
  return {
    conversation,
    actorAgentId: agentId,
    touchConversationInTransaction: async (id) => ({ ...conversation, id }),
    touchConversationAfterSend: async (id) => ({ ...conversation, id }),
  };
}

test('SQL: dos adquisiciones de lease concurrentes permiten una sola', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const agentId = randomUUID();
  const suffix = Date.now();
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IT-OUT-${suffix}`,
    phoneNumber: '+5491100009999',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
  t.after(async () => {
    await cleanupConversation(created.id);
  });

  const message = await conversationMessageRepository.createMessage({
    conversationId: created.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'hola',
    provider: 'twilio',
    providerMessageId: null,
    metadataJson: {
      clientRequestId: `req-${suffix}`,
      outboundDelivery: {
        state: OUTBOUND_DELIVERY_STATES.PENDING,
        dispatching: 'false',
      },
    },
  });

  const [a, b] = await Promise.all([
    tryAcquireOutboundDispatchLease(message.id, randomUUID()),
    tryAcquireOutboundDispatchLease(message.id, randomUUID()),
  ]);
  assert.equal(Boolean(a) !== Boolean(b), true);
  assert.equal(a || b, true);
});

test('SQL: dos entregas concurrentes llaman Twilio una sola vez', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const agentId = randomUUID();
  const clientRequestId = `req-${Date.now()}`;
  const suffix = Date.now();
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IT-OUT2-${suffix}`,
    phoneNumber: '+5491100008888',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
  t.after(async () => {
    await cleanupConversation(created.id);
  });

  const requestHash = hashAgentSendPayload({ body: 'lease-test', attachmentSha256: '' });
  await query(
    `INSERT INTO dbo.conversation_operation_requests (
      conversation_id, operation, client_request_id, actor_agent_id, request_hash
    ) VALUES ($1, $2, $3, $4, $5)`,
    [created.id, 'agent_send_message', clientRequestId, agentId, requestHash],
  );

  const message = await conversationMessageRepository.createMessage({
    conversationId: created.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'lease-test',
    provider: 'twilio',
    providerMessageId: null,
    metadataJson: {
      generatedBy: 'agent_inbox',
      agentId,
      clientRequestId,
      outboundDelivery: {
        state: OUTBOUND_DELIVERY_STATES.PENDING,
        requestHash,
        includeBody: true,
      },
    },
  });

  const ctx = ctxFor(created, agentId);
  const persisted = {
    message,
    attachmentRow: null,
    conversation: created,
    created: false,
  };

  let twilioCalls = 0;
  let releaseTwilio;
  const twilioGate = new Promise((resolve) => {
    releaseTwilio = resolve;
  });
  const prevTwilio = agentOutboundSendService._callTwilio;
  const prevSeed = agentOutboundSendService._isSeedConversation;
  agentOutboundSendService._isSeedConversation = async () => false;
  agentOutboundSendService._callTwilio = async () => {
    twilioCalls += 1;
    await twilioGate;
    return `SM-${suffix}`;
  };

  t.after(() => {
    agentOutboundSendService._callTwilio = prevTwilio;
    agentOutboundSendService._isSeedConversation = prevSeed;
  });

  const first = agentOutboundSendService._deliverReservedMessage(ctx, persisted, { trimmedBody: 'lease-test' });
  await new Promise((r) => setTimeout(r, 50));
  let secondError = null;
  await agentOutboundSendService._deliverReservedMessage(ctx, persisted, { trimmedBody: 'lease-test' })
    .catch((error) => {
      secondError = error;
    });
  releaseTwilio();
  const firstOutcome = await first;

  assert.equal(secondError?.code, 'OUTBOUND_IN_PROGRESS');
  assert.equal(twilioCalls, 1);
  assert.equal(firstOutcome.ok, true);

  const live = await conversationMessageRepository.findById(message.id);
  assert.equal(live?.metadataJson?.outboundDelivery?.state, OUTBOUND_DELIVERY_STATES.CONFIRMED);
});

test('SQL: lease vencido durante Twilio marca uncertain sin reenvío', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const suffix = Date.now();
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `IT-OUT3-${suffix}`,
    phoneNumber: '+5491100007777',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
  t.after(async () => {
    await cleanupConversation(created.id);
  });

  const message = await conversationMessageRepository.createMessage({
    conversationId: created.id,
    direction: 'outbound',
    senderType: 'agent',
    body: 'stale',
    provider: 'twilio',
    providerMessageId: null,
    metadataJson: {
      outboundDelivery: {
        state: OUTBOUND_DELIVERY_STATES.PENDING,
        dispatching: 'true',
        dispatchLeaseUntil: new Date(Date.now() - 60_000).toISOString(),
      },
    },
  });

  await expireStaleOutboundDispatchLeases(message.id);
  const live = await conversationMessageRepository.findById(message.id);
  assert.equal(live?.metadataJson?.outboundDelivery?.state, OUTBOUND_DELIVERY_STATES.UNCERTAIN);

  let twilioCalls = 0;
  const prevTwilio = agentOutboundSendService._callTwilio;
  const prevSeed = agentOutboundSendService._isSeedConversation;
  agentOutboundSendService._isSeedConversation = async () => false;
  agentOutboundSendService._callTwilio = async () => {
    twilioCalls += 1;
    return 'SM-stale';
  };
  t.after(() => {
    agentOutboundSendService._callTwilio = prevTwilio;
    agentOutboundSendService._isSeedConversation = prevSeed;
  });

  const ctx = ctxFor(created, randomUUID());
  await assert.rejects(
    () => agentOutboundSendService._deliverReservedMessage(
      ctx,
      { message: live, conversation: created, created: false, attachmentRow: null },
      { trimmedBody: 'stale' },
    ),
    (err) => err.code === 'OUTBOUND_UNCERTAIN',
  );
  assert.equal(twilioCalls, 0);
});