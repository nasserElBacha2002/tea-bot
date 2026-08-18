import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationReopenService } from './conversation-reopen.service.js';

function createClosedConversation(overrides = {}) {
  return {
    id: 'conv-closed',
    status: 'closed',
    closedAt: new Date('2026-05-21T12:00:00Z'),
    assignedAgentId: 'agent-old',
    channel: 'whatsapp',
    provider: 'twilio',
    ...overrides,
  };
}

function createService(overrides = {}) {
  const updates = [];
  let handoffCreated = false;

  const service = new ConversationReopenService({
    runTransaction: async (fn) => fn({}),
    conversationRepo: {
      findByIdForUpdate: async (id) => ({ id, ...createClosedConversation(), ...overrides.conversation }),
      updateConversation: async (id, patch) => {
        updates.push(patch);
        return { id, ...createClosedConversation(), ...patch };
      },
      ...overrides.conversationRepo,
    },
    sessionRepo: {
      endAllOpenForConversation: async () => {},
      ...overrides.sessionRepo,
    },
    handoffRepo: {
      findActiveByConversationIdForUpdate: async () => overrides.activeHandoffs ?? [],
      createHandoff: async () => {
        handoffCreated = true;
        throw new Error('should not create handoff');
      },
      ...overrides.handoffRepo,
    },
    audit: { record: async () => {} },
  });

  return { service, updates, wasHandoffCreated: () => handoffCreated };
}

test('reopenFromInboundMessage no-op si la conversación no está cerrada', async () => {
  const { service } = createService({
    conversationRepo: {
      updateConversation: async () => {
        throw new Error('should not update');
      },
    },
  });

  const conversation = { id: 'c1', status: 'bot' };
  const result = await service.reopenFromInboundMessage(conversation);
  assert.equal(result.reopened, false);
  assert.equal(result.conversation, conversation);
});

test('reopenFromInboundMessage sin handoff activo vuelve a bot', async () => {
  const { service, updates, wasHandoffCreated } = createService({ activeHandoffs: [] });

  const result = await service.reopenFromInboundMessage(createClosedConversation());
  assert.equal(result.reopened, true);
  assert.equal(updates[0].status, 'bot');
  assert.equal(updates[0].closedAt, null);
  assert.equal(updates[0].assignedAgentId, null);
  assert.equal(wasHandoffCreated(), false);
});

test('reopenFromInboundMessage con handoff resolved histórico vuelve a bot sin crear pending', async () => {
  const { service, updates, wasHandoffCreated } = createService({ activeHandoffs: [] });

  const result = await service.reopenFromInboundMessage(createClosedConversation());
  assert.equal(result.reopened, true);
  assert.equal(updates[0].status, 'bot');
  assert.equal(wasHandoffCreated(), false);
});

test('reopenFromInboundMessage con handoff pending activo vuelve a waiting_human', async () => {
  const pendingHandoff = {
    id: 'handoff-pending',
    status: 'pending',
    assignedAgentId: null,
  };
  const { service, updates, wasHandoffCreated } = createService({
    activeHandoffs: [pendingHandoff],
  });

  const result = await service.reopenFromInboundMessage(createClosedConversation());
  assert.equal(result.reopened, true);
  assert.equal(updates[0].status, 'waiting_human');
  assert.equal(wasHandoffCreated(), false);
  assert.equal(result.handoff?.id, 'handoff-pending');
});

test('reopenFromInboundMessage con handoff assigned preserva assignedAgentId', async () => {
  const assignedHandoff = {
    id: 'handoff-assigned',
    status: 'assigned',
    assignedAgentId: 'agent-42',
  };
  const { service, updates } = createService({
    activeHandoffs: [assignedHandoff],
  });

  const result = await service.reopenFromInboundMessage(createClosedConversation());
  assert.equal(result.reopened, true);
  assert.equal(updates[0].status, 'assigned');
  assert.equal(updates[0].assignedAgentId, 'agent-42');
  assert.equal(result.conversation.assignedAgentId, 'agent-42');
});
