import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConversationBotLifecycleService,
  isHandoffTerminalNode,
} from './conversation-bot-lifecycle.service.js';

function createLifecycleMocks(overrides = {}) {
  let conversation = {
    id: 'conv-1',
    status: 'assigned',
    assignedAgentId: 'agent-1',
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v21',
    currentNodeKey: 'human_handoff',
    externalUserId: 'twilio:whatsapp:+5491111111111',
    contactEmail: 'user@example.com',
    ...overrides.conversation,
  };

  const handoffs = [...(overrides.initialHandoffs || [
    {
      id: 'handoff-1',
      conversationId: 'conv-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
      requestedAt: new Date(),
    },
  ])];

  let session = overrides.initialSession ?? {
    id: 'sess-1',
    conversationId: 'conv-1',
    status: 'paused',
    currentNodeKey: 'human_handoff',
    flowId: 'main-menu',
  };

  const resetUsers = [];
  let transactionCommitted = false;

  const conversationRepo = {
    async findByIdForUpdate(id) {
      return id === conversation.id ? { ...conversation } : null;
    },
    async updateConversation(id, patch) {
      if (id !== conversation.id) return conversation;
      conversation = { ...conversation, ...patch };
      return conversation;
    },
    async findById(id) {
      return id === conversation.id ? conversation : null;
    },
  };

  const handoffRepo = {
    async findActiveByConversationId(conversationId) {
      return handoffs.filter(
        (h) => h.conversationId === conversationId && ['pending', 'assigned'].includes(h.status),
      );
    },
    async findActiveByConversationIdForUpdate(conversationId) {
      return this.findActiveByConversationId(conversationId);
    },
    async findLatestActiveByConversationId(conversationId) {
      const active = await this.findActiveByConversationId(conversationId);
      return active[0] || null;
    },
    async resolveActiveHandoffs(conversationId, patch) {
      const resolved = [];
      for (const handoff of handoffs) {
        if (
          handoff.conversationId === conversationId
          && ['pending', 'assigned'].includes(handoff.status)
        ) {
          handoff.status = 'resolved';
          handoff.resolvedAt = patch.resolvedAt || new Date();
          handoff.resolutionNote = patch.resolutionNote ?? null;
          resolved.push(handoff.id);
        }
      }
      return resolved;
    },
    async findPendingByConversationId(conversationId) {
      return handoffs.find((h) => h.conversationId === conversationId && h.status === 'pending')
        || null;
    },
  };

  const sessionRepo = {
    async endAllOpenForConversation(conversationId) {
      if (session.conversationId === conversationId && ['active', 'paused'].includes(session.status)) {
        session = { ...session, status: 'ended', endedAt: new Date() };
        return 1;
      }
      return 0;
    },
    async findLatestOpenByConversationId(conversationId) {
      if (
        session.conversationId === conversationId
        && ['active', 'paused'].includes(session.status)
      ) {
        return session;
      }
      return null;
    },
  };

  const runtimeSession = {
    async resetSession(userId) {
      resetUsers.push(userId);
    },
  };

  const runTransaction = async (fn) => {
    const result = await fn({ id: 'tx-1' });
    transactionCommitted = true;
    return result;
  };

  const service = new ConversationBotLifecycleService({
    conversationRepo,
    handoffRepo,
    sessionRepo,
    runtimeSession,
    runTransaction,
  });

  return {
    service,
    getState: () => ({ conversation, handoffs, session, resetUsers, transactionCommitted }),
  };
}

test('isHandoffTerminalNode reconoce nodos de handoff', () => {
  assert.equal(isHandoffTerminalNode('human_handoff'), true);
  assert.equal(isHandoffTerminalNode('welcome'), false);
});

test('returnConversationToBot resuelve handoff, cierra sesión pausada y resetea nodo', async () => {
  const { service, getState } = createLifecycleMocks();
  const result = await service.returnConversationToBot(getState().conversation, {
    resolutionNote: 'Caso resuelto',
  });
  const state = getState();

  assert.equal(result.conversation.status, 'bot');
  assert.equal(result.conversation.assignedAgentId, null);
  assert.notEqual(result.conversation.currentNodeKey, 'human_handoff');
  assert.equal(state.handoffs[0].status, 'resolved');
  assert.equal(state.session.status, 'ended');
  assert.equal(state.resetUsers[0], 'twilio:whatsapp:+5491111111111');
  assert.equal(state.transactionCommitted, true);
});

test('returnConversationToBot es idempotente', async () => {
  const { service, getState } = createLifecycleMocks({ initialHandoffs: [] });
  const conversation = getState().conversation;
  await service.returnConversationToBot(conversation);
  await service.returnConversationToBot(getState().conversation);
  const state = getState();
  assert.equal(state.handoffs.length, 0);
  assert.equal(state.conversation.status, 'bot');
});

test('normalizeLegacyBotStateIfNeeded corrige bot + human_handoff sin handoff activo', async () => {
  const { service, getState } = createLifecycleMocks({
    initialHandoffs: [],
    conversation: {
      status: 'bot',
      assignedAgentId: null,
      currentNodeKey: 'human_handoff',
    },
    initialSession: {
      id: 'sess-legacy',
      conversationId: 'conv-1',
      status: 'paused',
      currentNodeKey: 'human_handoff',
      flowId: 'main-menu',
    },
  });

  const result = await service.normalizeLegacyBotStateIfNeeded(getState().conversation);
  assert.equal(result.normalized, true);
  assert.notEqual(result.conversation.currentNodeKey, 'human_handoff');
  assert.equal(getState().session.status, 'ended');
});

test('normalizeLegacyBotStateIfNeeded no altera conversación con handoff activo', async () => {
  const { service, getState } = createLifecycleMocks();
  const result = await service.normalizeLegacyBotStateIfNeeded(getState().conversation);
  assert.equal(result.normalized, false);
  assert.equal(result.conversation.currentNodeKey, 'human_handoff');
});
