import test from 'node:test';
import assert from 'node:assert/strict';
import { HumanHandoffService } from './human-handoff.service.js';

function createMocks() {
  const handoffs = [];
  let conversation = {
    id: 'conv-1',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v21',
    currentNodeKey: 'welcome',
    assignedAgentId: null,
  };
  let session = {
    id: 'sess-1',
    conversationId: 'conv-1',
    status: 'active',
    currentNodeKey: 'welcome',
    flowId: 'main-menu',
    flowVersion: 'v21',
  };

  const handoffRepo = {
    async createHandoff(data) {
      const row = {
        id: `handoff-${handoffs.length + 1}`,
        conversationId: data.conversationId,
        requestedBy: data.requestedBy,
        reason: data.reason,
        status: data.status || 'pending',
        assignedAgentId: null,
        requestedAt: new Date(),
      };
      handoffs.push(row);
      return row;
    },
    async findPendingByConversationId(conversationId) {
      return (
        [...handoffs]
          .reverse()
          .find((h) => h.conversationId === conversationId && h.status === 'pending') || null
      );
    },
    async findLatestByConversationId(conversationId) {
      return (
        [...handoffs]
          .reverse()
          .find((h) => h.conversationId === conversationId) || null
      );
    },
  };

  const conversationRepo = {
    async updateConversation(id, patch) {
      if (id !== conversation.id) return conversation;
      conversation = { ...conversation, ...patch };
      return conversation;
    },
    async findById(id) {
      return id === conversation.id ? conversation : null;
    },
  };

  const sessionRepo = {
    async findActiveByConversationId(conversationId) {
      if (conversationId !== conversation.id || session.status !== 'active') return null;
      return session;
    },
    async updateSession(id, patch) {
      if (id !== session.id) return session;
      session = { ...session, ...patch };
      return session;
    },
  };

  return {
    handoffRepo,
    conversationRepo,
    sessionRepo,
    getState: () => ({ handoffs, conversation, session }),
  };
}

test('requestHumanHandoff crea pending y marca waiting_human con sesion pausada', async () => {
  const mocks = createMocks();
  const service = new HumanHandoffService(mocks);
  const { conversation, session } = mocks.getState();

  const result = await service.requestHumanHandoff(conversation, {
    engineResult: {
      reply: 'Te derivamos con el equipo.',
      flowId: 'main-menu',
      currentNodeId: 'human_handoff',
      terminalReason: 'human_handoff',
      requiresHuman: true,
    },
    dbSession: session,
  });

  const state = mocks.getState();
  assert.equal(state.handoffs.length, 1);
  assert.equal(state.handoffs[0].status, 'pending');
  assert.equal(state.conversation.status, 'waiting_human');
  assert.equal(state.conversation.currentNodeKey, 'human_handoff');
  assert.equal(state.session.status, 'paused');
  assert.equal(result.shouldSendConfirmation, true);
  assert.equal(result.confirmationMessage, 'Te derivamos con el equipo.');
});

test('ensurePendingHandoff reutiliza pending existente', async () => {
  const mocks = createMocks();
  const service = new HumanHandoffService(mocks);
  const { conversation, session } = mocks.getState();

  await service.requestHumanHandoff(conversation, {
    engineResult: { reply: 'A', currentNodeId: 'human_handoff' },
    dbSession: session,
  });

  mocks.getState().conversation.status = 'bot';

  const second = await service.ensurePendingHandoff(mocks.getState().conversation, {
    requestedBy: 'bot',
  });

  assert.equal(second.created, false);
  assert.equal(mocks.getState().handoffs.length, 1);
});

test('requestHumanHandoff no duplica confirmacion si ya estaba en human mode', async () => {
  const mocks = createMocks();
  const service = new HumanHandoffService(mocks);
  const { conversation, session } = mocks.getState();

  await service.requestHumanHandoff(conversation, {
    engineResult: { reply: 'Primera', currentNodeId: 'human_handoff' },
    dbSession: session,
  });

  const state = mocks.getState();
  const again = await service.requestHumanHandoff(state.conversation, {
    engineResult: { reply: 'Segunda', currentNodeId: 'human_handoff' },
    dbSession: state.session,
  });

  assert.equal(again.shouldSendConfirmation, false);
  assert.equal(mocks.getState().handoffs.length, 1);
});
