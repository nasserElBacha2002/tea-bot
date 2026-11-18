import test from 'node:test';
import assert from 'node:assert/strict';
import twilioMessageDeliveryService, {
  deliveryDeps,
  notifyLinkedOutboundDelivery,
} from './twilio-message-delivery.service.js';
import * as repository from '../monitoring/monitoring.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
const originals = {
  deps: { ...deliveryDeps },
};

function restoreDeps() {
  deliveryDeps.repository = originals.deps.repository;
  deliveryDeps.conversationMessageRepository = originals.deps.conversationMessageRepository;
  deliveryDeps.conversationRepository = originals.deps.conversationRepository;
  deliveryDeps.attachmentRepository = originals.deps.attachmentRepository;
  deliveryDeps.notifyConversationMessageUpdated = originals.deps.notifyConversationMessageUpdated;
}

test('processStatusCallback aplica sent, delivered y read en orden', async () => {
  const upserts = [];
  deliveryDeps.repository = {
    ...repository,
    applyDeliveryStatusAdvance: async (row) => {
      upserts.push(row);
      return { applied: true, previous: null };
    },
  };
  deliveryDeps.conversationMessageRepository = {
    findByProviderMessageId: async () => null,
  };

  const sent = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-1',
    MessageStatus: 'sent',
  });
  assert.equal(sent.applied, true);

  let previous = 'sent';
  deliveryDeps.repository.applyDeliveryStatusAdvance = async (row) => {
    const { shouldApplyDeliveryStatus } = await import('../monitoring/rules.js');
    if (!shouldApplyDeliveryStatus(previous, row.status)) {
      return { applied: false, previous, reason: 'stale_or_duplicate' };
    }
    upserts.push(row);
    previous = row.status;
    return { applied: true, previous: upserts.length > 1 ? upserts.at(-2)?.status ?? null : null };
  };

  const duplicate = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-1',
    MessageStatus: 'sent',
  });
  assert.equal(duplicate.applied, false);

  const delivered = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-1',
    MessageStatus: 'delivered',
  });
  assert.equal(delivered.applied, true);
  assert.equal(upserts.at(-1)?.status, 'delivered');

  const regress = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-1',
    MessageStatus: 'sent',
  });
  assert.equal(regress.applied, false);

  const read = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-1',
    MessageStatus: 'read',
  });
  assert.equal(read.applied, true);
  assert.equal(upserts.at(-1)?.status, 'read');

  restoreDeps();
});

test('processStatusCallback conserva failed y error de Twilio', async () => {
  deliveryDeps.repository = {
    ...repository,
    applyDeliveryStatusAdvance: async (row) => {
      assert.equal(row.status, 'failed');
      assert.equal(row.errorCode, '30008');
      assert.match(row.errorMessage, /Unknown/);
      return { applied: true, previous: 'sent' };
    },
  };
  deliveryDeps.conversationMessageRepository = {
    findByProviderMessageId: async () => null,
  };

  const failed = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-FAIL',
    MessageStatus: 'failed',
    ErrorCode: '30008',
    ErrorMessage: 'Unknown error',
  });
  assert.equal(failed.applied, true);

  deliveryDeps.repository.applyDeliveryStatusAdvance = async () => ({
    applied: false,
    previous: 'failed',
    reason: 'stale_or_duplicate',
  });
  const duplicate = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-FAIL',
    MessageStatus: 'delivered',
  });
  assert.equal(duplicate.applied, false);

  restoreDeps();
});

test('notifyLinkedOutboundDelivery publica solo el mensaje vinculado', async () => {
  let published = null;
  deliveryDeps.repository = {
    getDeliveryStatusRow: async () => ({
      provider: 'twilio',
      providerMessageId: 'SM-LINK',
      status: 'delivered',
      errorCode: null,
      errorMessage: null,
      statusAt: new Date().toISOString(),
    }),
  };
  deliveryDeps.conversationMessageRepository = {
    findByProviderMessageId: async () => ({
      id: 'msg-1',
      conversationId: 'conv-1',
      direction: 'outbound',
      senderType: 'agent',
      body: 'hola',
      provider: 'twilio',
      providerMessageId: 'SM-LINK',
      metadataJson: { outboundDelivery: { state: 'confirmed' } },
      createdAt: new Date().toISOString(),
    }),
  };
  deliveryDeps.conversationRepository = {
    getConversationById: async () => ({
      id: 'conv-1',
      channel: 'whatsapp',
      provider: 'twilio',
      status: 'assigned',
    }),
  };
  deliveryDeps.attachmentRepository = {
    findByMessageId: async () => [],
  };
  deliveryDeps.notifyConversationMessageUpdated = (_conversation, _message, extras = {}) => {
    published = extras;
  };

  const result = await notifyLinkedOutboundDelivery('SM-LINK');
  assert.equal(result.notified, true);
  assert.equal(published.whatsappDelivery?.status, 'delivered');

  restoreDeps();
});

test('callback previo a la vinculación no publica sin mensaje', async () => {
  deliveryDeps.repository = {
    ...repository,
    applyDeliveryStatusAdvance: async () => ({ applied: true, previous: null }),
  };
  deliveryDeps.conversationMessageRepository = {
    findByProviderMessageId: async () => null,
  };

  const early = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-EARLY',
    MessageStatus: 'sent',
  });
  assert.equal(early.applied, true);
  assert.equal(early.notified, false);

  restoreDeps();
});

test('callback duplicado recupera notificación sin reescribir estado', async () => {
  let notifyCalls = 0;
  deliveryDeps.repository = {
    ...repository,
    applyDeliveryStatusAdvance: async (row) => {
      if (notifyCalls === 0) {
        return { applied: true, previous: null };
      }
      return { applied: false, previous: row.status, reason: 'stale_or_duplicate' };
    },
  };
  deliveryDeps.conversationMessageRepository = {
    findByProviderMessageId: async () => ({
      id: 'msg-rec',
      conversationId: 'conv-rec',
      direction: 'outbound',
      senderType: 'agent',
      body: 'hola',
      provider: 'twilio',
      providerMessageId: 'SM-REC',
      metadataJson: { outboundDelivery: { state: 'confirmed' } },
      createdAt: new Date().toISOString(),
    }),
  };
  deliveryDeps.conversationRepository = {
    getConversationById: async () => ({ id: 'conv-rec', channel: 'whatsapp', provider: 'twilio' }),
  };
  deliveryDeps.attachmentRepository = { findByMessageId: async () => [] };
  deliveryDeps.repository.getDeliveryStatusRow = async () => ({ status: 'delivered' });
  deliveryDeps.notifyConversationMessageUpdated = () => {
    notifyCalls += 1;
    if (notifyCalls === 1) throw new Error('ws down');
  };

  const first = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-REC',
    MessageStatus: 'delivered',
  });
  assert.equal(first.applied, true);
  assert.equal(first.notified, false);

  deliveryDeps.notifyConversationMessageUpdated = () => {
    notifyCalls += 1;
    return undefined;
  };

  const second = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-REC',
    MessageStatus: 'delivered',
  });
  assert.equal(second.applied, false);
  assert.equal(second.notifyRecovered, true);
  assert.equal(second.notified, true);
  assert.equal(notifyCalls, 2);

  restoreDeps();
});

test('callback obsoleto no republica notificación', async () => {
  let notifyCalls = 0;
  deliveryDeps.repository = {
    ...repository,
    applyDeliveryStatusAdvance: async () => ({
      applied: false,
      previous: 'delivered',
      reason: 'stale_or_duplicate',
    }),
  };
  deliveryDeps.notifyConversationMessageUpdated = () => {
    notifyCalls += 1;
  };

  const regress = await twilioMessageDeliveryService.processStatusCallback({
    MessageSid: 'SM-NO-NOTIFY',
    MessageStatus: 'sent',
  });
  assert.equal(regress.applied, false);
  assert.equal(regress.notified, false);
  assert.equal(regress.notifyRecovered, false);
  assert.equal(notifyCalls, 0);

  restoreDeps();
});

test('mapMessagesPublicWithDelivery vincula lotes por MessageSid', () => {
  const messages = [
    {
      id: 'm1',
      conversationId: 'c1',
      direction: 'outbound',
      senderType: 'agent',
      body: 'a',
      provider: 'twilio',
      providerMessageId: 'SM-A',
      metadataJson: { outboundDelivery: { state: 'confirmed' } },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'm2',
      conversationId: 'c1',
      direction: 'outbound',
      senderType: 'agent',
      body: 'b',
      provider: 'twilio',
      providerMessageId: 'SM-B',
      metadataJson: { outboundDelivery: { state: 'confirmed' } },
      createdAt: new Date().toISOString(),
    },
  ];
  const deliveryMap = new Map([
    ['SM-A', { status: 'delivered' }],
    ['SM-B', { status: 'read' }],
  ]);
  const mapped = twilioMessageDeliveryService.mapMessagesPublicWithDelivery(messages, new Map(), deliveryMap);
  assert.equal(mapped[0].whatsappDelivery?.status, 'delivered');
  assert.equal(mapped[1].whatsappDelivery?.status, 'read');
});