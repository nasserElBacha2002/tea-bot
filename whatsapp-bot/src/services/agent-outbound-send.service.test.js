import test from 'node:test';
import assert from 'node:assert/strict';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import twilioMessageDeliveryService from './twilio-message-delivery.service.js';
import agentOutboundSendService, {
  hashAgentSendPayload,
  OUTBOUND_DELIVERY_STATES,
  maxOutboundBatchSize,
  twilioOutcomeFromError,
} from './agent-outbound-send.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const ctxBase = {
  conversation: {
    id: '11111111-1111-4111-8111-111111111111',
    channel: 'whatsapp',
    provider: 'twilio',
    phoneNumber: '+5491155551234',
    status: 'assigned',
    externalUserId: 'SIM-out',
  },
  actorAgentId: '22222222-2222-4222-8222-222222222222',
  touchConversationInTransaction: async (id) => ({ ...ctxBase.conversation, id }),
  touchConversationAfterSend: async (id) => ({ ...ctxBase.conversation, id }),
};

test('hashAgentSendPayload respeta contrato de request_hash', () => {
  const hash = hashAgentSendPayload({ body: 'hola', attachmentSha256: 'abc' });
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('maxOutboundBatchSize acota a 5', () => {
  assert.equal(maxOutboundBatchSize(), 5);
});

test('sendBatch reporta éxito parcial sin afirmar éxito total', async () => {
  const prev = agentOutboundSendService.sendSingleItem;
  agentOutboundSendService.sendSingleItem = async (_ctx, input) => {
    if (input.clientRequestId === 'bad') {
      return {
        ok: false,
        error: { code: 'TWILIO_SEND_FAILED', message: 'falló' },
        deliveryState: OUTBOUND_DELIVERY_STATES.FAILED,
      };
    }
    return {
      ok: true,
      message: { id: `m-${input.clientRequestId}` },
      conversation: ctxBase.conversation,
      deliveryState: OUTBOUND_DELIVERY_STATES.CONFIRMED,
    };
  };
  try {
    const data = await agentOutboundSendService.sendBatch(ctxBase, {
      attachments: [
        { clientRequestId: 'ok-1', mimeType: 'image/png', contentBase64: PNG.toString('base64') },
        { clientRequestId: 'bad', mimeType: 'image/png', contentBase64: PNG.toString('base64') },
      ],
    });
    assert.equal(data.partial, true);
    assert.equal(data.allSucceeded, false);
    assert.equal(data.results[0].ok, true);
    assert.equal(data.results[1].ok, false);
  } finally {
    agentOutboundSendService.sendSingleItem = prev;
  }
});

test('sendSingleItem falla sin clientRequestId', async () => {
  await assert.rejects(
    () => agentOutboundSendService.sendSingleItem(ctxBase, {
      body: 'hola',
      attachment: { mimeType: 'image/png', contentBase64: PNG.toString('base64') },
    }),
    (err) => err.code === 'CLIENT_REQUEST_ID_REQUIRED',
  );
});

test('twilioOutcomeFromError distingue incierto sin reintento automático', () => {
  assert.equal(twilioOutcomeFromError({ code: 'ETIMEDOUT' }).state, OUTBOUND_DELIVERY_STATES.UNCERTAIN);
  assert.equal(twilioOutcomeFromError({ code: 'ETIMEDOUT' }).retryable, false);
  assert.equal(twilioOutcomeFromError({ code: 'TWILIO_SEND_FAILED' }).retryable, true);
});

test('_deliverReservedMessage marca uncertain si SQL falla tras aceptación Twilio', async () => {
  const messageId = '33333333-3333-4333-8333-333333333333';
  const baseMessage = {
    id: messageId,
    metadataJson: { outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.PENDING } },
  };
  const prevFind = conversationMessageRepository.findById;
  const prevSeed = agentOutboundSendService._isSeedConversation;
  const prevTwilio = agentOutboundSendService._callTwilio;
  const prevFinalize = agentOutboundSendService._finalizeDelivery;
  const prevLease = agentOutboundSendService._acquireDispatchLease;

  let uncertainPatch = null;
  conversationMessageRepository.findById = async (id) => (
    id === messageId ? { ...baseMessage, id } : null
  );
  agentOutboundSendService._isSeedConversation = async () => false;
  agentOutboundSendService._acquireDispatchLease = async () => true;
  agentOutboundSendService._callTwilio = async () => 'SM-after-twilio';
  agentOutboundSendService._finalizeDelivery = async (id, patch) => {
    if (patch.state === OUTBOUND_DELIVERY_STATES.CONFIRMED) {
      throw new Error('SQL finalize failed');
    }
    if (patch.state === OUTBOUND_DELIVERY_STATES.UNCERTAIN) {
      uncertainPatch = patch;
      return {
        ...baseMessage,
        providerMessageId: patch.providerMessageId,
        metadataJson: { outboundDelivery: { state: patch.state } },
      };
    }
    return baseMessage;
  };

  try {
    await assert.rejects(
      () => agentOutboundSendService._deliverReservedMessage(
        ctxBase,
        {
          message: baseMessage,
          conversation: ctxBase.conversation,
          created: true,
          attachmentRow: null,
        },
        { trimmedBody: 'hola' },
      ),
      (err) => err.code === 'OUTBOUND_UNCERTAIN',
    );
    assert.equal(uncertainPatch?.providerMessageId, 'SM-after-twilio');
    assert.equal(uncertainPatch?.state, OUTBOUND_DELIVERY_STATES.UNCERTAIN);
  } finally {
    conversationMessageRepository.findById = prevFind;
    agentOutboundSendService._isSeedConversation = prevSeed;
    agentOutboundSendService._callTwilio = prevTwilio;
    agentOutboundSendService._finalizeDelivery = prevFinalize;
    agentOutboundSendService._acquireDispatchLease = prevLease;
  }
});

test('_deliverReservedMessage idempotente reconcilia entrega WhatsApp previa', async () => {
  const messageId = '55555555-5555-4555-8555-555555555555';
  const confirmed = {
    id: messageId,
    conversationId: ctxBase.conversation.id,
    direction: 'outbound',
    senderType: 'agent',
    provider: 'twilio',
    providerMessageId: 'SM-sync',
    metadataJson: { outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.CONFIRMED } },
  };
  const prevFind = conversationMessageRepository.findById;
  const prevTwilio = agentOutboundSendService._callTwilio;
  const prevSync = twilioMessageDeliveryService.syncDeliveryAfterOutboundLink;
  let syncCalls = 0;
  conversationMessageRepository.findById = async () => confirmed;
  agentOutboundSendService._callTwilio = async () => {
    throw new Error('should-not-call-twilio');
  };
  twilioMessageDeliveryService.syncDeliveryAfterOutboundLink = async () => {
    syncCalls += 1;
    return { notified: true };
  };
  try {
    await agentOutboundSendService._deliverReservedMessage(
      ctxBase,
      {
        message: confirmed,
        conversation: ctxBase.conversation,
        created: false,
        attachmentRow: null,
      },
      { trimmedBody: '' },
    );
    assert.equal(syncCalls, 1);
  } finally {
    conversationMessageRepository.findById = prevFind;
    agentOutboundSendService._callTwilio = prevTwilio;
    twilioMessageDeliveryService.syncDeliveryAfterOutboundLink = prevSync;
  }
});

test('_deliverReservedMessage reanuda pending sin duplicar confirmado', async () => {
  const messageId = '44444444-4444-4444-8444-444444444444';
  const confirmed = {
    id: messageId,
    providerMessageId: 'SM-done',
    metadataJson: { outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.CONFIRMED } },
  };
  const prevFind = conversationMessageRepository.findById;
  const prevTwilio = agentOutboundSendService._callTwilio;
  let twilioCalls = 0;
  conversationMessageRepository.findById = async () => confirmed;
  agentOutboundSendService._callTwilio = async () => {
    twilioCalls += 1;
    return 'SM-should-not-run';
  };
  try {
    const result = await agentOutboundSendService._deliverReservedMessage(
      ctxBase,
      {
        message: confirmed,
        conversation: ctxBase.conversation,
        created: false,
        attachmentRow: null,
      },
      { trimmedBody: '' },
    );
    assert.equal(twilioCalls, 0);
    assert.equal(result.idempotent, true);
    assert.equal(result.deliveryState, OUTBOUND_DELIVERY_STATES.CONFIRMED);
  } finally {
    conversationMessageRepository.findById = prevFind;
    agentOutboundSendService._callTwilio = prevTwilio;
  }
});

test('sendBatch envía texto solo en el primer archivo', async () => {
  const calls = [];
  const prev = agentOutboundSendService.sendSingleItem;
  agentOutboundSendService.sendSingleItem = async (_ctx, input) => {
    calls.push(input);
    return {
      ok: true,
      message: { id: `m-${input.clientRequestId}` },
      conversation: ctxBase.conversation,
      deliveryState: OUTBOUND_DELIVERY_STATES.CONFIRMED,
    };
  };
  try {
    await agentOutboundSendService.sendBatch(ctxBase, {
      body: 'caption',
      attachments: [
        { clientRequestId: 'f1', mimeType: 'image/png', contentBase64: PNG.toString('base64') },
        { clientRequestId: 'f2', mimeType: 'image/png', contentBase64: PNG.toString('base64') },
      ],
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].includeBody, true);
    assert.equal(calls[0].body, 'caption');
    assert.equal(calls[1].includeBody, false);
    assert.equal(calls[1].body, 'caption');
  } finally {
    agentOutboundSendService.sendSingleItem = prev;
  }
});

test('sendBatch honra includeBody explícito en reintentos', async () => {
  const calls = [];
  const prev = agentOutboundSendService.sendSingleItem;
  agentOutboundSendService.sendSingleItem = async (_ctx, input) => {
    calls.push(input);
    return {
      ok: true,
      message: { id: `m-${input.clientRequestId}` },
      conversation: ctxBase.conversation,
      deliveryState: OUTBOUND_DELIVERY_STATES.CONFIRMED,
    };
  };
  try {
    await agentOutboundSendService.sendBatch(ctxBase, {
      body: 'caption',
      attachments: [
        { clientRequestId: 'f2', mimeType: 'image/png', contentBase64: PNG.toString('base64'), includeBody: false },
      ],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].includeBody, false);
  } finally {
    agentOutboundSendService.sendSingleItem = prev;
  }
});

test('_deliverReservedMessage rechaza segundo despacho concurrente', async () => {
  const messageId = '55555555-5555-4555-8555-555555555555';
  const pending = {
    id: messageId,
    metadataJson: { outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.PENDING } },
  };
  const prevFind = conversationMessageRepository.findById;
  const prevSeed = agentOutboundSendService._isSeedConversation;
  const prevTwilio = agentOutboundSendService._callTwilio;
  const prevLease = agentOutboundSendService._acquireDispatchLease;

  conversationMessageRepository.findById = async () => pending;
  agentOutboundSendService._isSeedConversation = async () => false;
  agentOutboundSendService._acquireDispatchLease = async () => false;
  agentOutboundSendService._callTwilio = async () => {
    throw new Error('twilio should not run');
  };
  try {
    await assert.rejects(
      () => agentOutboundSendService._deliverReservedMessage(
        ctxBase,
        { message: pending, conversation: ctxBase.conversation, created: false, attachmentRow: null },
        { trimmedBody: 'hola' },
      ),
      (err) => err.code === 'OUTBOUND_IN_PROGRESS',
    );
  } finally {
    conversationMessageRepository.findById = prevFind;
    agentOutboundSendService._isSeedConversation = prevSeed;
    agentOutboundSendService._callTwilio = prevTwilio;
    agentOutboundSendService._acquireDispatchLease = prevLease;
  }
});

test('_deliverReservedMessage permite reintentar failed tras adquirir lease', async () => {
  const messageId = '66666666-6666-4666-8666-666666666666';
  const failed = {
    id: messageId,
    body: 'reintento',
    metadataJson: {
      outboundDelivery: { state: OUTBOUND_DELIVERY_STATES.FAILED, includeBody: true },
    },
  };
  const prevFind = conversationMessageRepository.findById;
  const prevSeed = agentOutboundSendService._isSeedConversation;
  const prevTwilio = agentOutboundSendService._callTwilio;
  const prevFinalize = agentOutboundSendService._finalizeDelivery;
  const prevLease = agentOutboundSendService._acquireDispatchLease;
  let twilioCalls = 0;

  conversationMessageRepository.findById = async () => failed;
  agentOutboundSendService._isSeedConversation = async () => false;
  agentOutboundSendService._acquireDispatchLease = async () => true;
  agentOutboundSendService._callTwilio = async (phone, { body }) => {
    twilioCalls += 1;
    assert.equal(body, 'reintento');
    return 'SM-retry';
  };
  agentOutboundSendService._finalizeDelivery = async (id, patch) => ({
    ...failed,
    providerMessageId: patch.providerMessageId,
    metadataJson: { outboundDelivery: { state: patch.state } },
  });

  try {
    const result = await agentOutboundSendService._deliverReservedMessage(
      ctxBase,
      { message: failed, conversation: ctxBase.conversation, created: false, attachmentRow: null },
      { trimmedBody: 'reintento' },
    );
    assert.equal(twilioCalls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.deliveryState, OUTBOUND_DELIVERY_STATES.CONFIRMED);
  } finally {
    conversationMessageRepository.findById = prevFind;
    agentOutboundSendService._isSeedConversation = prevSeed;
    agentOutboundSendService._callTwilio = prevTwilio;
    agentOutboundSendService._finalizeDelivery = prevFinalize;
    agentOutboundSendService._acquireDispatchLease = prevLease;
  }
});