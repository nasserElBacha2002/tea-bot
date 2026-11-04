import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import { ConversationReentryService } from './conversation-reentry.service.js';
import { HumanHandoffService } from './human-handoff.service.js';
import { FlowEngine } from './flow-engine.service.js';
import messagePersistence from './message-persistence.service.js';
import conversationService from './conversation.service.js';
import conversationReentryService, { REENTRY_PROMPT } from './conversation-reentry.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from './session.service.js';
import webhookDedupe from './webhook-dedupe.service.js';
import { classifyReentryInput, noteReentryColumn } from '../utils/conversation-reentry-policy.js';

const CASE_ID = '7ED6C057-3ED1-422E-B0EB-F36A9E15F1A3';
const FREE_TEXT = 'Quería seguir con la misma consulta de inscripciones';

function buildFlow({ entryNode = 'welcome' } = {}) {
  return {
    id: 'main-menu',
    version: 'v11',
    entryNode,
    fallbackNode: 'fallback_global',
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        message: '¡Hola! Bienvenido/a. Elegí una opción.',
        transitions: [{ type: 'match', value: '1', nextNode: 'no_presenciales_menu' }],
      },
      {
        id: 'collect_email',
        type: 'message',
        message: 'Para continuar, enviá tu email.',
        transitions: [],
      },
      {
        id: 'no_presenciales_menu',
        type: 'message',
        message: 'Consultas presenciales. Elegí una opción.',
        transitions: [{ type: 'match', value: '1', nextNode: 'welcome' }],
      },
      {
        id: 'human_handoff',
        type: 'message',
        message: 'Te derivamos con una persona.',
        transitions: [],
      },
      {
        id: 'fallback_global',
        type: 'message',
        message: 'No pude entender tu respuesta. Elegí una opción del menú.',
        transitions: [],
      },
    ],
  };
}

function createWorld(overrides = {}) {
  const userId = overrides.userId || `twilio:whatsapp:+54911re${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
  let conversation = {
    id: overrides.id || CASE_ID,
    status: 'assigned',
    assignedAgentId: 'agent-anon',
    externalUserId: userId,
    contactEmail: overrides.contactEmail === undefined ? 'student@example.com' : overrides.contactEmail,
    displayName: 'Estudiante anonimo',
    phoneNumber: null,
    channel: 'whatsapp',
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v11',
    currentNodeKey: 'human_handoff',
    reentryJson: null,
    ...overrides.conversation,
  };
  let sessions = [
    {
      id: 'sess-open',
      conversationId: conversation.id,
      status: 'paused',
      flowId: 'main-menu',
      flowVersion: 'v11',
      currentNodeKey: 'human_handoff',
      variablesJson: { modalidad: 'presencial' },
      historyJson: ['welcome', 'no_menu', 'no_presenciales_menu'],
      trackingJson: {
        answers: { modalidad: 'presencial' },
        visitedNodes: ['welcome', 'no_menu', 'no_presenciales_menu', 'human_handoff'],
        transitionTrail: [
          { from: 'no_menu', to: 'no_presenciales_menu' },
          { from: 'no_presenciales_menu', to: 'human_handoff' },
        ],
      },
      ...(overrides.session || {}),
    },
  ];
  const handoffs = [
    { id: 'handoff-old', conversationId: conversation.id, status: 'resolved' },
    {
      id: 'handoff-active',
      conversationId: conversation.id,
      status: 'assigned',
      assignedAgentId: 'agent-anon',
    },
    ...(overrides.extraHandoffs || []),
  ];

  let tail = Promise.resolve();
  const runTransaction = (fn) => {
    const run = tail.then(() => fn({ id: 'tx' }));
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const conversationRepo = {
    async findByIdForUpdate(id) {
      if (id !== conversation.id) return null;
      return {
        ...conversation,
        reentryJson: conversation.reentryJson ? { ...conversation.reentryJson } : null,
      };
    },
    async updateConversation(id, patch) {
      if (id !== conversation.id) return conversation;
      conversation = { ...conversation, ...patch };
      return { ...conversation };
    },
    async findById(id) {
      return this.findByIdForUpdate(id);
    },
  };

  const sessionRepo = {
    async findLatestOpenByConversationId(conversationId) {
      return sessions.find(
        (item) => item.conversationId === conversationId
          && (item.status === 'active' || item.status === 'paused'),
      ) || null;
    },
    async findActiveByConversationId(conversationId) {
      return sessions.find(
        (item) => item.conversationId === conversationId && item.status === 'active',
      ) || null;
    },
    async endAllOpenForConversation(conversationId) {
      let count = 0;
      sessions = sessions.map((item) => {
        if (
          item.conversationId === conversationId
          && (item.status === 'active' || item.status === 'paused')
        ) {
          count += 1;
          return { ...item, status: 'ended', endedAt: new Date() };
        }
        return item;
      });
      return count;
    },
    async createSession(data) {
      const row = {
        id: `sess-${sessions.length + 1}`,
        status: 'active',
        variablesJson: {},
        historyJson: [],
        trackingJson: {},
        ...data,
      };
      sessions.push(row);
      return row;
    },
    async updateSession(id, patch) {
      sessions = sessions.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return sessions.find((item) => item.id === id) || null;
    },
  };

  const handoffRepo = {
    async resolveActiveHandoffs(conversationId, patch = {}) {
      const ids = [];
      for (const handoff of handoffs) {
        if (
          handoff.conversationId === conversationId
          && (handoff.status === 'pending' || handoff.status === 'assigned')
        ) {
          handoff.status = 'resolved';
          handoff.resolvedAt = patch.resolvedAt || new Date();
          handoff.resolutionNote = patch.resolutionNote ?? null;
          ids.push(handoff.id);
        }
      }
      return ids;
    },
    async ensurePendingHandoffAtomic(conversationId) {
      const active = handoffs.find(
        (item) => item.conversationId === conversationId
          && (item.status === 'pending' || item.status === 'assigned'),
      );
      if (active) return { handoff: active, created: false };
      const handoff = {
        id: `handoff-new-${handoffs.length + 1}`,
        conversationId,
        status: 'pending',
        requestedBy: 'bot',
      };
      handoffs.push(handoff);
      return { handoff, created: true };
    },
    async findActiveByConversationIdForUpdate(conversationId) {
      return handoffs.filter(
        (item) => item.conversationId === conversationId
          && (item.status === 'pending' || item.status === 'assigned'),
      );
    },
  };

  const handoffService = new HumanHandoffService({
    conversationRepo,
    sessionRepo,
    handoffRepo,
    runTransaction,
  });
  const lifecycle = new ConversationBotLifecycleService({
    conversationRepo,
    sessionRepo,
    handoffRepo,
    runtimeSession: sessionService,
    runTransaction,
  });
  const reentry = new ConversationReentryService({
    conversationRepo,
    sessionRepo,
    handoffService,
    runtimeSession: sessionService,
    flowLoader: {
      async getFlow() {
        return overrides.flow || buildFlow();
      },
    },
    loadHistoricalFlow: overrides.loadHistoricalFlow,
    runTransaction,
    policy: () => (process.env.REENTRY_POLICY === 'legacy' ? 'legacy' : 'prompt'),
  });

  return {
    userId,
    lifecycle,
    reentry,
    handoffs,
    get conversation() {
      return conversation;
    },
    get sessions() {
      return sessions;
    },
  };
}

async function closeHumanCase(world) {
  await sessionService.resetSession(world.userId);
  return world.lifecycle.returnConversationToBot(world.conversation, {
    resolutionNote: 'caso anonimizado',
  });
}

test('caso 7ED6C057 anonimizado: el texto libre posterior al cierre no cae en fallback_global', async () => {
  const world = createWorld();
  await closeHumanCase(world);

  assert.equal(world.conversation.status, 'bot');
  assert.equal(world.conversation.assignedAgentId, null);
  assert.equal(world.conversation.currentNodeKey, null);
  assert.equal(world.conversation.contactEmail, 'student@example.com');
  assert.equal(world.conversation.reentryJson.status, 'pending');
  assert.equal(world.conversation.reentryJson.resumeNodeKey, 'no_presenciales_menu');
  assert.deepEqual(world.conversation.reentryJson.variables, { modalidad: 'presencial' });
  assert.equal(world.handoffs.find((item) => item.id === 'handoff-old').status, 'resolved');
  assert.equal(world.handoffs.find((item) => item.id === 'handoff-active').status, 'resolved');
  assert.equal(world.sessions[0].status, 'ended');

  const first = await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  assert.equal(first.action, 'prompt');
  assert.equal(first.reply, REENTRY_PROMPT);
  assert.equal(/fallback_global|No pude entender/i.test(first.reply), false);
  assert.equal(world.conversation.currentNodeKey, null);
  assert.equal(world.conversation.reentryJson.status, 'awaiting_choice');
  assert.equal(world.conversation.reentryJson.triggerText, FREE_TEXT);
  assert.equal(world.sessions.filter((item) => item.status === 'active').length, 0);
});

test('elegir continuar restaura el nodo y no reabre handoffs resueltos', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);

  const choice = await world.reentry.consumeInbound(world.conversation, 'continuar');
  assert.equal(choice.action, 'present_node');
  assert.match(choice.reply, /presenciales/i);
  assert.equal(choice.nodeKey, 'no_presenciales_menu');
  assert.equal(world.conversation.reentryJson, null);
  assert.equal(world.conversation.currentNodeKey, 'no_presenciales_menu');
  assert.equal(world.conversation.contactEmail, 'student@example.com');
  const active = world.sessions.find((item) => item.status === 'active');
  assert.equal(active.currentNodeKey, 'no_presenciales_menu');
  assert.deepEqual(active.variablesJson, { modalidad: 'presencial' });
  assert.deepEqual(active.historyJson, ['welcome', 'no_menu', 'no_presenciales_menu']);
  assert.equal(world.handoffs.filter((item) => item.status === 'pending' || item.status === 'assigned').length, 0);
  assert.equal(world.handoffs.find((item) => item.id === 'handoff-old').status, 'resolved');

  const memory = sessionService.getSession(world.userId);
  assert.equal(memory.currentNode, 'no_presenciales_menu');
  assert.deepEqual(memory.history, ['welcome', 'no_menu', 'no_presenciales_menu']);
  assert.deepEqual(memory.variables, { modalidad: 'presencial' });
  await sessionService.resetSession(world.userId);
});

test('elegir nueva consulta presenta el entry y no usa el comando como opción', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  const choice = await world.reentry.consumeInbound(world.conversation, '2');
  assert.equal(choice.action, 'present_entry');
  assert.equal(world.conversation.reentryJson, null);
  assert.equal(world.conversation.currentNodeKey, null);

  await sessionService.resetSession(world.userId);
  const engine = new FlowEngine();
  const result = await engine.resolveIncomingMessage({
    userId: world.userId,
    text: '2',
    flowId: 'main-menu',
    flowSnapshot: buildFlow(),
    conversationContext: world.conversation,
  });
  assert.equal(result.currentNodeId, 'welcome');
  assert.match(result.reply, /Bienvenido/i);
  assert.equal(/No pude entender/i.test(result.reply), false);
  await sessionService.resetSession(world.userId);
});

test('pedir una persona abre un handoff nuevo y conserva los históricos resueltos', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  const choice = await world.reentry.consumeInbound(world.conversation, 'quiero hablar con una persona');
  assert.equal(choice.action, 'handoff');
  assert.equal(world.conversation.status, 'waiting_human');
  assert.equal(world.conversation.reentryJson, null);
  assert.equal(world.handoffs.find((item) => item.id === 'handoff-old').status, 'resolved');
  assert.equal(world.handoffs.find((item) => item.id === 'handoff-active').status, 'resolved');
  const created = world.handoffs.filter((item) => item.status === 'pending');
  assert.equal(created.length, 1);
  assert.notEqual(created[0].id, 'handoff-old');
  await sessionService.resetSession(world.userId);
});

test('menú en la reentrada muestra el menú publicado y no el fallback', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  const choice = await world.reentry.consumeInbound(world.conversation, 'menú');
  assert.equal(choice.action, 'present_entry');
  assert.equal(world.conversation.currentNodeKey, null);

  await sessionService.resetSession(world.userId);
  const result = await new FlowEngine().resolveIncomingMessage({
    userId: world.userId,
    text: 'menú',
    flowId: 'main-menu',
    flowSnapshot: buildFlow(),
    conversationContext: world.conversation,
  });
  assert.equal(result.currentNodeId, 'welcome');
  assert.equal(/No pude entender/i.test(result.reply), false);
  await sessionService.resetSession(world.userId);
});

test('sin email, una consulta nueva presenta collect_email', async () => {
  const world = createWorld({
    contactEmail: null,
    flow: buildFlow({ entryNode: 'collect_email' }),
  });
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, 'hola, sigo con la consulta');
  const choice = await world.reentry.consumeInbound(world.conversation, 'nueva consulta');
  assert.equal(choice.action, 'present_entry');
  assert.equal(world.conversation.contactEmail, null);

  await sessionService.resetSession(world.userId);
  const result = await new FlowEngine().resolveIncomingMessage({
    userId: world.userId,
    text: 'nueva consulta',
    flowId: 'main-menu',
    flowSnapshot: buildFlow({ entryNode: 'collect_email' }),
    conversationContext: { ...world.conversation, contactEmail: null, phoneNumber: null },
  });
  assert.equal(result.currentNodeId, 'collect_email');
  assert.match(result.reply, /email/i);
  assert.equal(/No pude entender/i.test(result.reply), false);
  await sessionService.resetSession(world.userId);
});

test('sesión sin nodo compatible continúa por el entry y no por fallback_global', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  world.conversation.reentryJson = {
    ...world.conversation.reentryJson,
    status: 'awaiting_choice',
    resumeNodeKey: 'nodo_que_ya_no_existe',
  };
  const choice = await world.reentry.consumeInbound(world.conversation, '1');
  assert.equal(choice.action, 'present_entry');
  assert.equal(choice.reason, 'node_removed');
  assert.equal(world.conversation.reentryJson, null);
  assert.equal(world.conversation.currentNodeKey, null);

  await sessionService.resetSession(world.userId);
  const result = await new FlowEngine().resolveIncomingMessage({
    userId: world.userId,
    text: '1',
    flowId: 'main-menu',
    flowSnapshot: buildFlow(),
    conversationContext: world.conversation,
  });
  assert.equal(result.currentNodeId, 'welcome');
  assert.equal(result.currentNodeId === 'fallback_global', false);
  await sessionService.resetSession(world.userId);
});

test('handoff activo no dispara la reentrada', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  world.conversation.status = 'waiting_human';
  const pending = { ...world.conversation.reentryJson };
  const result = await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  assert.equal(result.action, 'human_skip');
  assert.equal(world.conversation.reentryJson.status, pending.status);
  assert.equal(world.conversation.status, 'waiting_human');
});

test('varios handoffs históricos no se reactivan al continuar', async () => {
  const world = createWorld({
    extraHandoffs: [
      { id: 'handoff-older', conversationId: CASE_ID, status: 'resolved' },
    ],
  });
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  await world.reentry.consumeInbound(world.conversation, 'seguir');
  assert.deepEqual(
    world.handoffs.map((item) => item.status),
    ['resolved', 'resolved', 'resolved'],
  );
  await sessionService.resetSession(world.userId);
});

test('dos webhooks simultáneos dejan una sola transición a awaiting_choice', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  const [first, second] = await Promise.all([
    world.reentry.consumeInbound(world.conversation, 'sigo con la inscripción'),
    world.reentry.consumeInbound(world.conversation, 'otra frase libre'),
  ]);
  const actions = [first.action, second.action].sort();
  assert.deepEqual(actions, ['prompt', 'reprompt']);
  assert.equal(world.conversation.reentryJson.status, 'awaiting_choice');
  assert.equal(/No pude entender/i.test(first.reply + second.reply), false);
});

test('reentrega del mismo MessageSid no vuelve a consumir la reentrada', async () => {
  const world = createWorld({ id: `case-${Date.now()}` });
  await closeHumanCase(world);
  const messageId = `SM-reentry-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let consumes = 0;

  async function deliver() {
    const key = webhookDedupe.buildProviderMessageKey('twilio', messageId);
    if (await webhookDedupe.isDuplicate(key)) return { duplicate: true };
    await webhookDedupe.markProcessed(key);
    consumes += 1;
    return world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  }

  const first = await deliver();
  const second = await deliver();
  assert.equal(first.duplicate, undefined);
  assert.equal(first.action, 'prompt');
  assert.equal(second.duplicate, true);
  assert.equal(consumes, 1);
  assert.equal(world.conversation.reentryJson.status, 'awaiting_choice');
});

test('cierre concurrente no deja que el sync del motor pise el cursor', async () => {
  const original = conversationService.syncSessionFromFlowEngine;
  const world = createWorld();
  await closeHumanCase(world);
  const nodeBefore = world.conversation.currentNodeKey;
  let sessionWrites = 0;
  const result = await (async () => {
    const conversationRepository = (await import('../repositories/conversation.repository.js')).default;
    const sessionRepository = (await import('../repositories/conversation-session.repository.js')).default;
    const prevUpdate = conversationRepository.updateFlowPositionIfNoReentry;
    const prevSession = sessionRepository.updateSession;
    conversationRepository.updateFlowPositionIfNoReentry = async () => null;
    sessionRepository.updateSession = async () => {
      sessionWrites += 1;
      return null;
    };
    try {
      return conversationService.syncSessionFromFlowEngine(
        world.conversation,
        { id: 'sess-stale' },
        world.userId,
        { flowId: 'main-menu', currentNodeId: 'fallback_global', reply: 'No pude entender' },
      );
    } finally {
      conversationRepository.updateFlowPositionIfNoReentry = prevUpdate;
      sessionRepository.updateSession = prevSession;
    }
  })();

  assert.equal(result, null);
  assert.equal(sessionWrites, 0);
  assert.equal(world.conversation.currentNodeKey, nodeBefore);
  assert.equal(original === conversationService.syncSessionFromFlowEngine, true);
  await sessionService.resetSession(world.userId);
});

test('rollback legacy con reentrada pendiente presenta el flujo y no el fallback', async () => {
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  const world = createWorld();
  try {
    await closeHumanCase(world);
    await world.reentry.consumeInbound(world.conversation, 'armado');
    process.env.REENTRY_POLICY = 'legacy';
    world.conversation.reentryJson = {
      ...world.conversation.reentryJson,
      status: 'awaiting_choice',
    };
    const rolled = await world.reentry.consumeInbound(world.conversation, 'sigo acá');
    assert.equal(rolled.action, 'legacy_cleared');
    assert.equal(world.conversation.reentryJson, null);
    assert.equal(world.conversation.currentNodeKey, null);

    await sessionService.resetSession(world.userId);
    const result = await new FlowEngine().resolveIncomingMessage({
      userId: world.userId,
      text: 'sigo acá',
      flowId: 'main-menu',
      flowSnapshot: buildFlow(),
      conversationContext: world.conversation,
    });
    assert.equal(result.currentNodeId, 'welcome');
    assert.equal(/No pude entender/i.test(result.reply), false);
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await sessionService.resetSession(world.userId);
  }
});

test('handleInbound no crea una sesión de welcome para el primer texto de reentrada', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  let sessionCreated = false;
  const previousConsume = conversationReentryService.consumeInbound;
  conversationReentryService.consumeInbound = (conversation, text) => world.reentry.consumeInbound(conversation, text);
  const previousHandoff = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => null;
  const original = {};
  const stubs = {
    isEnabled: () => true,
    findOrCreateTwilioConversation: async () => ({ conversation: world.conversation, created: false }),
    reloadConversation: async () => world.conversation,
    reopenClosedConversationIfNeeded: async (conversation) => conversation,
    persistInboundMessage: async () => ({ id: 'msg-in' }),
    persistOutboundBotMessage: async (_conversation, reply) => {
      assert.equal(reply, REENTRY_PROMPT);
      return { id: 'msg-out' };
    },
    getOrCreateActiveSession: async () => {
      sessionCreated = true;
      return { session: { id: 'should-not' }, created: true };
    },
    hydrateRuntimeSessionIfNeeded: async () => {
      throw new Error('no debe hidratar el menú');
    },
  };
  for (const [key, fn] of Object.entries(stubs)) {
    original[key] = conversationService[key];
    conversationService[key] = fn;
  }
  try {
    const result = await messagePersistence.handleInbound({
      userId: world.userId,
      flowId: 'main-menu',
      text: FREE_TEXT,
      messageId: 'SM-reentry-inbound',
      provider: 'twilio',
      rawPayload: {},
    });
    assert.equal(result.skipFlowEngine, true);
    assert.equal(result.reentryReply, REENTRY_PROMPT);
    assert.equal(sessionCreated, false);
  } finally {
    humanHandoffRepository.findLatestActiveByConversationId = previousHandoff;
    conversationReentryService.consumeInbound = previousConsume;
    for (const [key, fn] of Object.entries(original)) {
      conversationService[key] = fn;
    }
    await sessionService.resetSession(world.userId);
  }
});

test('respuestas inválidas persistidas salen de awaiting_choice sin abrir un handoff', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  const first = await world.reentry.consumeInbound(world.conversation, 'algo');
  assert.equal(first.action, 'reprompt');
  assert.equal(world.conversation.reentryJson.invalidAttempts, 1);
  const second = await world.reentry.consumeInbound(world.conversation, 'tampoco');
  assert.equal(second.action, 'reprompt');
  assert.equal(world.conversation.reentryJson.invalidAttempts, 2);
  const third = await world.reentry.consumeInbound(world.conversation, 'sigue sin ser una opción');
  assert.equal(third.action, 'present_entry');
  assert.equal(third.reason, 'invalid_choice_limit');
  assert.equal(world.conversation.reentryJson, null);
  assert.equal(world.handoffs.filter((item) => item.status === 'pending' || item.status === 'assigned').length, 0);

  await sessionService.resetSession(world.userId);
  const result = await new FlowEngine().resolveIncomingMessage({
    userId: world.userId,
    text: 'sigue sin ser una opción',
    flowId: 'main-menu',
    flowSnapshot: buildFlow(),
    conversationContext: world.conversation,
  });
  assert.equal(result.currentNodeId, 'welcome');
  assert.equal(/No pude entender/i.test(result.reply), false);
  await sessionService.resetSession(world.userId);
});

test('un humano asignado tiene precedencia y no consume la reentrada', async () => {
  const world = createWorld();
  await closeHumanCase(world);
  world.conversation.status = 'assigned';
  world.conversation.assignedAgentId = 'agent-futuro';
  const pending = { ...world.conversation.reentryJson };
  const result = await world.reentry.consumeInbound(world.conversation, 'quiero hablar con una persona');
  assert.equal(result.action, 'human_skip');
  assert.equal(world.conversation.reentryJson.status, 'pending');
  assert.equal(world.conversation.reentryJson.resumeNodeKey, pending.resumeNodeKey);
  assert.equal(world.handoffs.filter((item) => item.status === 'pending').length, 0);
});

test('nodo eliminado en la misma versión reinicia y no restaura', async () => {
  const published = buildFlow();
  published.nodes = published.nodes.filter((node) => node.id !== 'no_presenciales_menu');
  const world = createWorld({ flow: published });
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  const choice = await world.reentry.consumeInbound(world.conversation, '1');
  assert.equal(choice.action, 'present_entry');
  assert.equal(choice.reason, 'node_removed');
  assert.equal(world.conversation.reentryJson, null);
  assert.equal(world.conversation.currentNodeKey, null);
});

test('versión histórica con nodo modificado no se restaura', async () => {
  const published = buildFlow();
  published.version = 'v24';
  const node = published.nodes.find((item) => item.id === 'no_presenciales_menu');
  node.message = 'Menú publicado distinto.';
  const world = createWorld({
    flow: published,
    loadHistoricalFlow: async () => buildFlow(),
  });
  await closeHumanCase(world);
  assert.equal(world.conversation.reentryJson.flowVersion, 'v11');
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  const choice = await world.reentry.consumeInbound(world.conversation, 'continuar');
  assert.equal(choice.action, 'present_entry');
  assert.equal(choice.reason, 'node_modified');
  assert.equal(world.conversation.currentFlowVersion, 'v11');
});

test('versión histórica compatible migra al flujo publicado', async () => {
  const historical = buildFlow();
  const published = buildFlow();
  published.version = 'v24';
  const world = createWorld({
    flow: published,
    loadHistoricalFlow: async () => historical,
  });
  await closeHumanCase(world);
  await world.reentry.consumeInbound(world.conversation, FREE_TEXT);
  const choice = await world.reentry.consumeInbound(world.conversation, '1');
  assert.equal(choice.action, 'present_node');
  assert.equal(choice.reason, 'migrated_published');
  assert.equal(choice.nodeKey, 'no_presenciales_menu');
  assert.equal(world.conversation.currentFlowVersion, 'v24');
  assert.match(choice.reply, /Consultas presenciales/);
});

test('sin la columna, el cierre no escribe reentry y deja el cursor en null', async () => {
  noteReentryColumn(false);
  try {
    const world = createWorld();
    await closeHumanCase(world);
    assert.equal(world.conversation.status, 'bot');
    assert.equal(world.conversation.currentNodeKey, null);
    assert.equal(world.conversation.reentryJson, null);
    assert.equal(world.conversation.contactEmail, 'student@example.com');
  } finally {
    noteReentryColumn(null);
  }
});

test('el primer texto que dice continuar no se consume como elección', () => {
  assert.equal(classifyReentryInput('continuar', 'pending'), 'present');
  assert.equal(classifyReentryInput('continuar', 'awaiting_choice'), 'continue');
  assert.equal(classifyReentryInput('1️⃣', 'awaiting_choice'), 'continue');
  assert.equal(classifyReentryInput('menú', 'pending'), 'fresh');
  assert.equal(classifyReentryInput('quiero hablar con una persona', 'pending'), 'human');
});
