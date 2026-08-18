import test from 'node:test';
import assert from 'node:assert/strict';
import messagePersistenceService from './message-persistence.service.js';
import conversationService from './conversation.service.js';
import conversationBotLifecycleService from './conversation-bot-lifecycle.service.js';
import humanHandoffService from './human-handoff.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';

const baseEvent = {
  userId: 'twilio:whatsapp:+5491111111111',
  flowId: 'main-menu',
  text: 'Hola',
  messageId: 'SM-test-1',
  provider: 'twilio',
  rawPayload: { From: 'whatsapp:+5491111111111' },
};

function stubConversationService(stubs) {
  const original = {};
  for (const [key, fn] of Object.entries(stubs)) {
    original[key] = conversationService[key];
    conversationService[key] = fn;
  }
  return () => {
    for (const [key, fn] of Object.entries(original)) {
      conversationService[key] = fn;
    }
  };
}

test('messagePersistence.isEnabled refleja CONVERSATION_DB_ENABLED', () => {
  const previous = {
    enabled: process.env.CONVERSATION_DB_ENABLED,
    server: process.env.DB_SERVER,
  };
  process.env.DB_SERVER = '';
  process.env.CONVERSATION_DB_ENABLED = 'false';
  assert.equal(messagePersistenceService.isEnabled(), false);
  process.env.CONVERSATION_DB_ENABLED = 'true';
  assert.equal(messagePersistenceService.isEnabled(), true);
  if (previous.enabled === undefined) {
    delete process.env.CONVERSATION_DB_ENABLED;
  } else {
    process.env.CONVERSATION_DB_ENABLED = previous.enabled;
  }
  if (previous.server === undefined) {
    delete process.env.DB_SERVER;
  } else {
    process.env.DB_SERVER = previous.server;
  }
});

test('safeRun no relanza cuando DB falla y strict desactivado', async () => {
  const previousStrict = process.env.CONVERSATION_DB_STRICT;
  const previousEnabled = process.env.CONVERSATION_DB_ENABLED;
  process.env.CONVERSATION_DB_STRICT = '0';
  process.env.CONVERSATION_DB_ENABLED = 'true';
  process.env.DB_SERVER = '';
  process.env.DB_NAME = 'tea_bot';
  process.env.DB_USER = 'sa';
  process.env.DB_PASSWORD = 'x';

  const result = await messagePersistenceService.safeRun('test', async () => {
    throw new Error('db down');
  });

  assert.equal(result, null);

  if (previousStrict === undefined) delete process.env.CONVERSATION_DB_STRICT;
  else process.env.CONVERSATION_DB_STRICT = previousStrict;
  if (previousEnabled === undefined) delete process.env.CONVERSATION_DB_ENABLED;
  else process.env.CONVERSATION_DB_ENABLED = previousEnabled;
});

test('handleInbound en waiting_human persiste mensaje y omite flow engine', async () => {
  const restore = stubConversationService({
    isEnabled: () => true,
    findOrCreateTwilioConversation: async () => ({
      conversation: { id: 'conv-1', status: 'waiting_human' },
      created: false,
    }),
    reloadConversation: async (c) => c,
    reopenClosedConversationIfNeeded: async (c) => c,
    persistInboundMessage: async (conversation, event, meta) => {
      assert.equal(conversation.status, 'waiting_human');
      assert.equal(meta.skipReason, 'conversation_waiting_human');
      return { id: 'msg-1' };
    },
  });

  try {
    const result = await messagePersistenceService.handleInbound(baseEvent);
    assert.equal(result.skipFlowEngine, true);
    assert.equal(result.dbSession, null);
  } finally {
    restore();
  }
});

test('handleInbound en assigned mantiene modo humano', async () => {
  const restore = stubConversationService({
    isEnabled: () => true,
    findOrCreateTwilioConversation: async () => ({
      conversation: { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' },
      created: false,
    }),
    reloadConversation: async (c) => c,
    reopenClosedConversationIfNeeded: async (c) => c,
    persistInboundMessage: async (_conversation, _event, meta) => {
      assert.equal(meta.skipReason, 'conversation_assigned');
      return { id: 'msg-2' };
    },
  });

  try {
    const result = await messagePersistenceService.handleInbound(baseEvent);
    assert.equal(result.skipFlowEngine, true);
  } finally {
    restore();
  }
});

test('handleInbound en bot normaliza legacy y continúa al flow engine', async () => {
  let normalized = false;
  let sessionCreated = false;

  const restore = stubConversationService({
    isEnabled: () => true,
    findOrCreateTwilioConversation: async () => ({
      conversation: {
        id: 'conv-legacy',
        status: 'bot',
        currentNodeKey: 'human_handoff',
      },
      created: false,
    }),
    reloadConversation: async (c) => c,
    reopenClosedConversationIfNeeded: async (c) => c,
    persistInboundMessage: async () => ({ id: 'msg-3' }),
    getOrCreateActiveSession: async () => {
      sessionCreated = true;
      return { session: { id: 'sess-1', currentNodeKey: 'welcome' }, created: true };
    },
    hydrateRuntimeSessionIfNeeded: async () => ({ currentNode: 'welcome' }),
  });

  const prevNormalize = conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded;
  conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = async (conversation) => {
    normalized = true;
    return {
      conversation: { ...conversation, currentNodeKey: 'welcome' },
      normalized: true,
    };
  };

  const prevFindActive = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => null;

  try {
    const result = await messagePersistenceService.handleInbound(baseEvent);
    assert.equal(normalized, true);
    assert.equal(sessionCreated, true);
    assert.equal(result.skipFlowEngine, false);
  } finally {
    humanHandoffRepository.findLatestActiveByConversationId = prevFindActive;
    conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = prevNormalize;
    restore();
  }
});

test('handleInbound con bot + handoff activo inconsistente omite flow engine', async () => {
  let sessionCreated = false;
  const restore = stubConversationService({
    isEnabled: () => true,
    findOrCreateTwilioConversation: async () => ({
      conversation: {
        id: 'conv-inconsistent',
        status: 'bot',
        currentNodeKey: 'human_handoff',
      },
      created: false,
    }),
    reloadConversation: async (c) => c,
    reopenClosedConversationIfNeeded: async (c) => c,
    persistInboundMessage: async (_conversation, _event, meta) => {
      assert.equal(meta.skipReason, 'inconsistent_active_handoff');
      return { id: 'msg-inconsistent' };
    },
    getOrCreateActiveSession: async () => {
      sessionCreated = true;
      return { session: { id: 'sess-x' }, created: true };
    },
  });

  const prevFindActive = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => ({
    id: 'handoff-pending',
    status: 'pending',
  });

  try {
    const result = await messagePersistenceService.handleInbound(baseEvent);
    assert.equal(result.skipFlowEngine, true);
    assert.equal(sessionCreated, false);
  } finally {
    humanHandoffRepository.findLatestActiveByConversationId = prevFindActive;
    restore();
  }
});

test('ensurePendingHandoff evita duplicar handoff activo assigned', async () => {
  const { HumanHandoffService } = await import('./human-handoff.service.js');
  const handoffs = [{
    id: 'handoff-assigned',
    conversationId: 'conv-1',
    status: 'assigned',
    assignedAgentId: 'agent-1',
  }];

  const service = new HumanHandoffService({
    runTransaction: async (fn) => fn({}),
    handoffRepo: {
      ensurePendingHandoffAtomic: async () => ({ handoff: handoffs[0], created: false }),
    },
    conversationRepo: {
      findByIdForUpdate: async () => ({ id: 'conv-1', status: 'bot' }),
      updateConversation: async (_id, patch) => ({ id: 'conv-1', ...patch }),
    },
    sessionRepo: {
      findActiveByConversationId: async () => null,
      updateSession: async (_id, patch) => ({ id: 'sess-1', ...patch }),
    },
  });

  const result = await service.ensurePendingHandoff({ id: 'conv-1', status: 'bot' });
  assert.equal(result.created, false);
  assert.equal(result.handoff.id, 'handoff-assigned');
});

test('isEngineHandoffResult mantiene fallback por currentNodeId para flujos publicados', () => {
  assert.equal(humanHandoffService.isEngineHandoffResult({ currentNodeId: 'human_handoff' }), true);
  assert.equal(
    humanHandoffService.isEngineHandoffResult({ currentNodeId: 'welcome', requiresHuman: false }),
    false,
  );
});
