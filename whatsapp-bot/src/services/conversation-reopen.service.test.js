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

test('reopenFromInboundMessage no-op si la conversación no está cerrada', async () => {
  const service = new ConversationReopenService({
    conversationRepo: {
      updateConversation: async () => {
        throw new Error('should not update');
      },
    },
    sessionRepo: {
      endAllActiveForConversation: async () => {},
    },
    handoffRepo: {
      findLatestByConversationId: async () => null,
    },
    audit: { record: async () => {} },
  });

  const conversation = { id: 'c1', status: 'bot' };
  const result = await service.reopenFromInboundMessage(conversation);
  assert.equal(result.reopened, false);
  assert.equal(result.conversation, conversation);
});

test('reopenFromInboundMessage sin handoff previo vuelve a bot', async () => {
  const updates = [];
  const service = new ConversationReopenService({
    conversationRepo: {
      updateConversation: async (id, patch) => {
        updates.push(patch);
        return { id, ...createClosedConversation(), ...patch };
      },
    },
    sessionRepo: {
      endAllActiveForConversation: async () => {},
    },
    handoffRepo: {
      findLatestByConversationId: async () => null,
      findPendingByConversationId: async () => null,
      createHandoff: async () => {
        throw new Error('should not create handoff');
      },
    },
    audit: { record: async () => {} },
  });

  const result = await service.reopenFromInboundMessage(createClosedConversation());
  assert.equal(result.reopened, true);
  assert.equal(updates[0].status, 'bot');
  assert.equal(updates[0].closedAt, null);
  assert.equal(updates[0].assignedAgentId, null);
});

test('reopenFromInboundMessage con handoff previo vuelve a waiting_human y crea pending', async () => {
  const updates = [];
  let handoffCreated = false;
  const service = new ConversationReopenService({
    conversationRepo: {
      updateConversation: async (id, patch) => {
        updates.push(patch);
        return { id, ...createClosedConversation(), ...patch };
      },
    },
    sessionRepo: {
      endAllActiveForConversation: async () => {},
    },
    handoffRepo: {
      findLatestByConversationId: async () => ({
        id: 'handoff-1',
        status: 'resolved',
      }),
      findPendingByConversationId: async () => null,
      createHandoff: async () => {
        handoffCreated = true;
        return {
          id: 'handoff-new',
          conversationId: 'conv-closed',
          status: 'pending',
          reason: 'conversation_reopened',
        };
      },
    },
    audit: { record: async () => {} },
  });

  const result = await service.reopenFromInboundMessage(createClosedConversation());
  assert.equal(result.reopened, true);
  assert.equal(updates[0].status, 'waiting_human');
  assert.equal(handoffCreated, true);
});
