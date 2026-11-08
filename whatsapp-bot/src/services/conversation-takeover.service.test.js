import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationTakeoverService } from './conversation-takeover.service.js';
import { evaluateAutomaticReply } from './conversation-turn-guard.service.js';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import { ConversationReentryService, REENTRY_PROMPT } from './conversation-reentry.service.js';
import { getReentryColumnState, noteReentryColumn } from '../utils/conversation-reentry-policy.js';
import sessionService from './session.service.js';

const AGENT_A = '11111111-1111-4111-8111-111111111111';
const AGENT_B = '22222222-2222-4222-8222-222222222222';

function actor(agentId, role = 'conversations_only', username = agentId) {
  return { agentId, role, username };
}

function createHarness(initial = {}) {
  let conversation = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'bot',
    assignedAgentId: null,
    statusVersion: 3,
    currentNodeKey: 'welcome',
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v11',
    externalUserId: 'twilio:whatsapp:+5491100000001',
    provider: 'internal',
    reentryJson: null,
    contactEmail: 'student@example.com',
    ...initial.conversation,
  };
  let handoffs = [...(initial.handoffs || [])];
  let sessions = [...(initial.sessions || [{
    id: 'sess-1',
    conversationId: conversation.id,
    status: 'active',
    flowId: 'main-menu',
    flowVersion: 'v11',
    currentNodeKey: 'no_presenciales_menu',
    historyJson: ['welcome', 'no_presenciales_menu'],
    variablesJson: { modalidad: 'presencial' },
    trackingJson: { visitedNodes: ['welcome', 'no_presenciales_menu'] },
  }])];
  const messages = [];
  const audits = [];
  const operationRequests = [];
  const notifications = [];
  const resets = [];
  let updateCalls = 0;

  let tail = Promise.resolve();
  const runTransaction = (fn) => {
    const run = tail.then(() => fn({ id: 'tx' }));
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const conversationRepo = {
    async findByIdForUpdate(id) {
      if (id !== conversation.id) return null;
      return { ...conversation, reentryJson: conversation.reentryJson ? { ...conversation.reentryJson } : null };
    },
    async findById(id) {
      return this.findByIdForUpdate(id);
    },
    async updateConversation(id, patch) {
      if (id !== conversation.id) return null;
      updateCalls += 1;
      const next = { ...conversation };
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'incrementStatusVersion') {
          if (value) next.statusVersion = Number(next.statusVersion || 0) + 1;
        } else {
          next[key] = value;
        }
      }
      conversation = next;
      return { ...conversation };
    },
  };

  const handoffRepo = {
    async findActiveByConversationIdForUpdate(conversationId) {
      return handoffs.filter(
        (item) => item.conversationId === conversationId
          && (item.status === 'pending' || item.status === 'assigned'),
      );
    },
    async updateHandoff(id, patch) {
      const handoff = handoffs.find((item) => item.id === id);
      Object.assign(handoff, patch);
      return { ...handoff };
    },
    async createHandoff(data) {
      const handoff = {
        id: `handoff-${handoffs.length + 1}`,
        status: 'pending',
        ...data,
      };
      handoffs.push(handoff);
      return { ...handoff };
    },
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
  };

  const sessionRepo = {
    async pauseAllOpenForConversation(conversationId) {
      let count = 0;
      sessions = sessions.map((item) => {
        if (item.conversationId === conversationId && item.status === 'active') {
          count += 1;
          return { ...item, status: 'paused' };
        }
        return item;
      });
      return count;
    },
    async findLatestOpenByConversationId(conversationId) {
      return sessions.find(
        (item) => item.conversationId === conversationId
          && (item.status === 'active' || item.status === 'paused'),
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
          return { ...item, status: 'ended' };
        }
        return item;
      });
      return count;
    },
  };

  const messageRepo = {
    async createMessage(data) {
      const row = { id: `msg-${messages.length + 1}`, ...data };
      messages.push(row);
      return row;
    },
    async findLatestReturnToBot() {
      return null;
    },
    async listOutboundSince() {
      return [];
    },
  };

  const service = new ConversationTakeoverService({
    conversationRepo,
    sessionRepo,
    messageRepo,
    handoffRepo,
    runtimeSession: {
      async resetSession(userId) {
        resets.push(userId);
        await sessionService.resetSession(userId);
      },
    },
    runTransaction,
    notifyAssigned(conversationRow, handoff) {
      if (initial.notifyFails) {
        throw new Error('socket down');
      }
      notifications.push({ conversationRow, handoff });
    },
    async recordAudit(entry) {
      audits.push(entry);
    },
    async findOperationRequest(conversationId, operation, clientRequestId) {
      return operationRequests.find((row) => (
        row.conversationId === conversationId
        && row.operation === operation
        && row.clientRequestId === clientRequestId
      )) || null;
    },
    async saveOperationRequest(entry) {
      const exists = operationRequests.find((row) => (
        row.conversationId === entry.conversationId
        && row.operation === entry.operation
        && row.clientRequestId === entry.clientRequestId
      ));
      if (exists) {
        const error = new Error('duplicate');
        error.number = 2627;
        throw error;
      }
      operationRequests.push({ ...entry });
      return entry;
    },
    resolveTargetAgent(username) {
      if (username === 'ana') {
        return { username: 'ana', role: 'admin', agentId: AGENT_A, enabled: true };
      }
      if (username === 'luis') {
        return { username: 'luis', role: 'conversations_only', agentId: AGENT_B, enabled: true };
      }
      return null;
    },
    enabled: () => initial.enabled !== false,
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
    handoffService: { async requestHumanHandoff() { throw new Error('no handoff in this test'); } },
    runtimeSession: sessionService,
    flowLoader: { async getFlow() { return { id: 'main-menu', nodes: [] }; } },
    runTransaction,
    policy: () => 'prompt',
    queriesEnabled: () => false,
    messageRepo,
  });

  return {
    service,
    lifecycle,
    reentry,
    notifications,
    resets,
    audits,
    operationRequests,
    messages,
    get conversation() { return conversation; },
    get handoffs() { return handoffs; },
    get sessions() { return sessions; },
    get updateCalls() { return updateCalls; },
  };
}

test('bot activo: la toma pausa el bot y el inbound siguiente no responde solo', async () => {
  const world = createHarness();
  const result = await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
    reason: 'el usuario está en bucle',
  });

  assert.equal(result.conversation.status, 'assigned');
  assert.equal(result.conversation.assignedAgentId, AGENT_A);
  assert.equal(result.conversation.botPaused, true);
  assert.equal(result.conversation.canTakeover, false);
  assert.equal(world.sessions[0].status, 'paused');
  assert.equal(world.handoffs.length, 1);
  assert.equal(world.handoffs[0].status, 'assigned');
  assert.equal(world.handoffs[0].reason, 'manual_takeover');
  assert.equal(world.messages[0].metadataJson.event, 'manual_takeover');
  assert.equal(world.audits.length, 1);
  assert.equal(world.resets.length, 1);
  assert.equal(world.notifications.length, 1);

  const barrier = await evaluateAutomaticReply(
    { id: world.conversation.id, status: 'bot', statusVersion: 3 },
    3,
    {
      dbEnabled: () => true,
      conversationRepo: {
        async findByIdForUpdate() {
          return world.conversation;
        },
      },
      runTransaction: (fn) => fn({}),
    },
  );
  assert.equal(barrier.suppress, true);
  assert.equal(barrier.reason, 'not_bot');
});

test('dos agentes en paralelo: uno toma y el otro recibe conflicto', async () => {
  const world = createHarness();
  const [first, second] = await Promise.allSettled([
    world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_A, 'conversations_only', 'ana'),
    }),
    world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_B, 'admin', 'luis'),
    }),
  ]);

  const fulfilled = [first, second].filter((item) => item.status === 'fulfilled');
  const rejected = [first, second].filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'CONVERSATION_OWNED');
  assert.equal(world.handoffs.filter((item) => item.status === 'assigned').length, 1);
  assert.notEqual(world.conversation.assignedAgentId, null);
});

test('doble clic del mismo agente no duplica handoff ni mensaje', async () => {
  const world = createHarness();
  const input = {
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'conversations_only', 'ana'),
    clientRequestId: 'click-1',
  };
  const first = await world.service.takeover(input);
  const second = await world.service.takeover(input);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(world.handoffs.length, 1);
  assert.equal(world.messages.length, 1);
  assert.equal(world.audits.length, 1);
  assert.equal(world.conversation.statusVersion, 4);
});

test('sin permiso no escribe', async () => {
  const world = createHarness();
  await assert.rejects(
    () => world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_A, 'viewer', 'ana'),
    }),
    (error) => error.code === 'FORBIDDEN' && error.httpStatus === 403,
  );
  assert.equal(world.updateCalls, 0);
  assert.equal(world.conversation.status, 'bot');
  assert.equal(world.handoffs.length, 0);
});

test('handoff pendiente se asigna y el resuelto no se reabre', async () => {
  const world = createHarness({
    conversation: { status: 'waiting_human' },
    handoffs: [
      {
        id: 'old',
        conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'resolved',
        reason: 'caso anterior',
      },
      {
        id: 'pending',
        conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'pending',
        reason: 'human_handoff',
        assignedAgentId: null,
      },
    ],
  });
  await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
  });
  assert.equal(world.handoffs.find((item) => item.id === 'old').status, 'resolved');
  assert.equal(world.handoffs.find((item) => item.id === 'pending').status, 'assigned');
  assert.equal(world.handoffs.find((item) => item.id === 'pending').assignedAgentId, AGENT_A);
  assert.equal(world.handoffs.length, 2);
});

test('reentrada pendiente se cancela en la misma toma', async () => {
  const world = createHarness({
    conversation: {
      reentryJson: { status: 'awaiting_choice', resumeNodeKey: 'welcome' },
    },
  });
  await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'conversations_only', 'ana'),
  });
  assert.equal(world.conversation.status, 'assigned');
  assert.equal(world.conversation.reentryJson, null);
});

test('el estado queda en el repositorio después de soltar la instancia', async () => {
  const world = createHarness();
  await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
  });
  const restarted = createHarness();
  assert.equal(world.conversation.status, 'assigned');
  assert.equal(world.conversation.assignedAgentId, AGENT_A);
  assert.notEqual(restarted.conversation.id, null);
  const barrier = await evaluateAutomaticReply(
    world.conversation,
    world.conversation.statusVersion,
    {
      dbEnabled: () => true,
      conversationRepo: {
        async findByIdForUpdate() { return world.conversation; },
      },
      runTransaction: (fn) => fn({}),
    },
  );
  assert.equal(barrier.suppress, true);
});

test('devolver al bot después de tomar ofrece reentrada y no un fallback', async () => {
  const previous = process.env.REENTRY_POLICY;
  const previousColumn = getReentryColumnState();
  process.env.REENTRY_POLICY = 'prompt';
  noteReentryColumn(true);
  const world = createHarness();
  try {
    await world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_A, 'admin', 'ana'),
    });
    const returned = await world.lifecycle.returnConversationToBot(world.conversation, {
      resolutionNote: 'volvemos al bot',
    });
    assert.equal(returned.conversation.status, 'bot');
    assert.equal(returned.conversation.reentryJson.status, 'pending');
    assert.equal(returned.conversation.currentNodeKey, null);
    const inbound = await world.reentry.consumeInbound(returned.conversation, 'sigo con la misma consulta');
    assert.equal(inbound.action, 'prompt');
    assert.equal(inbound.reply, REENTRY_PROMPT);
    assert.equal(/No pude entender|fallback/i.test(inbound.reply), false);
    assert.equal(world.conversation.currentNodeKey, null);
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    noteReentryColumn(
      previousColumn === 'ready' ? true : previousColumn === 'missing' ? false : null,
    );
  }
});

test('si el websocket falla la toma queda commiteada y el GET la ve', async () => {
  const world = createHarness({ notifyFails: true });
  const result = await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
  });
  assert.equal(result.conversation.status, 'assigned');
  assert.equal(world.notifications.length, 0);
  assert.equal(world.conversation.status, 'assigned');
  assert.equal(result.conversation.botPaused, true);
  assert.equal(result.conversation.takeoverBlock, 'already_owner');
});

test('la toma apagada y la versión vieja no escriben', async () => {
  const disabled = createHarness({ enabled: false });
  await assert.rejects(
    () => disabled.service.takeover({
      conversationId: disabled.conversation.id,
      actor: actor(AGENT_A, 'admin', 'ana'),
    }),
    (error) => error.code === 'TAKEOVER_DISABLED',
  );
  assert.equal(disabled.updateCalls, 0);

  const world = createHarness();
  await assert.rejects(
    () => world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_A, 'admin', 'ana'),
      expectedVersion: 1,
    }),
    (error) => error.code === 'STATUS_VERSION_CONFLICT',
  );
  assert.equal(world.updateCalls, 0);
  assert.equal(world.conversation.status, 'bot');
});

test('la reasignación no usa la toma y un operador no puede reasignar', async () => {
  const world = createHarness({
    conversation: { status: 'assigned', assignedAgentId: AGENT_A, statusVersion: 8 },
    handoffs: [{
      id: 'owned',
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'assigned',
      assignedAgentId: AGENT_A,
    }],
  });
  await assert.rejects(
    () => world.service.reassign({
      conversationId: world.conversation.id,
      actor: actor(AGENT_B, 'conversations_only', 'luis'),
      targetUsername: 'ana',
      reason: 'cobertura',
    }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.equal(world.conversation.assignedAgentId, AGENT_A);

  const moved = await world.service.reassign({
    conversationId: world.conversation.id,
    actor: actor(AGENT_B, 'admin', 'supervisor'),
    targetUsername: 'luis',
    reason: 'cambio de turno',
  });
  assert.equal(moved.conversation.status, 'assigned');
  assert.notEqual(moved.conversation.assignedAgentId, AGENT_A);
  assert.equal(world.handoffs.length, 1);
  assert.equal(world.messages.at(-1).metadataJson.event, 'manual_reassign');
  assert.equal(world.conversation.reentryJson, null);
});

test('otro actor no reutiliza un clientRequestId como toma exitosa', async () => {
  const world = createHarness();
  await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
    clientRequestId: 'click-shared',
  });
  await assert.rejects(
    () => world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_B, 'conversations_only', 'luis'),
      clientRequestId: 'click-shared',
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(world.messages.length, 1);
  assert.equal(world.conversation.assignedAgentId, AGENT_A);
});

test('el mismo request no vuelve a tomar después de una reasignación', async () => {
  const world = createHarness();
  await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
    clientRequestId: 'click-ana',
    reason: 'primera',
  });
  await world.service.reassign({
    conversationId: world.conversation.id,
    actor: actor(AGENT_B, 'admin', 'supervisor'),
    targetUsername: 'luis',
    reason: 'turno',
  });
  const before = world.messages.length;
  await assert.rejects(
    () => world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_A, 'admin', 'ana'),
      clientRequestId: 'click-ana',
      reason: 'primera',
    }),
    (error) => error.code === 'IDEMPOTENCY_STALE',
  );
  assert.equal(world.messages.length, before);
  assert.equal(world.conversation.assignedAgentId, AGENT_B);
});

test('un destino inexistente no reasigna', async () => {
  const world = createHarness({
    conversation: { status: 'assigned', assignedAgentId: AGENT_A, statusVersion: 4 },
    handoffs: [{
      id: 'owned',
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'assigned',
      assignedAgentId: AGENT_A,
    }],
  });
  await assert.rejects(
    () => world.service.reassign({
      conversationId: world.conversation.id,
      actor: actor(AGENT_B, 'admin', 'supervisor'),
      targetUsername: 'nadie',
      reason: 'cobertura',
    }),
    (error) => error.code === 'TARGET_AGENT_NOT_FOUND',
  );
  assert.equal(world.conversation.assignedAgentId, AGENT_A);
});

test('varios handoffs activos quedan en una sola asignación', async () => {
  const world = createHarness({
    handoffs: [
      {
        id: 'old',
        conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'pending',
        requestedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'new',
        conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'assigned',
        requestedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
  });
  await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
  });
  const active = world.handoffs.filter((item) => item.status === 'pending' || item.status === 'assigned');
  assert.equal(active.length, 1);
  assert.equal(active[0].id, 'new');
  assert.equal(active[0].assignedAgentId, AGENT_A);
  assert.equal(world.handoffs.find((item) => item.id === 'old').status, 'resolved');
});

test('con el flag apagado no exige el esquema ni toma la conversación', async () => {
  let schemaChecks = 0;
  const world = createHarness({ enabled: false });
  world.service.assertSchema = async () => {
    schemaChecks += 1;
  };
  await assert.rejects(
    () => world.service.takeover({
      conversationId: world.conversation.id,
      actor: actor(AGENT_A, 'admin', 'ana'),
    }),
    (error) => error.code === 'TAKEOVER_DISABLED',
  );
  assert.equal(schemaChecks, 0);
  assert.equal(world.conversation.status, 'bot');
});

test('el mensaje interno de la toma no sale por WhatsApp', async () => {
  const world = createHarness();
  await world.service.takeover({
    conversationId: world.conversation.id,
    actor: actor(AGENT_A, 'admin', 'ana'),
  });
  assert.equal(world.messages[0].senderType, 'system');
  assert.equal(world.messages[0].provider, 'internal');
  assert.equal(world.messages[0].metadataJson.event, 'manual_takeover');
});
