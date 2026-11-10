import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { isConversationDbEnabled, pingDatabase, query, closePool } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import flowLoader from '../utils/flow-loader.js';
import sessionService from './session.service.js';
import { FlowEngine } from './flow-engine.service.js';
import webhookDedupe from './webhook-dedupe.service.js';
import conversationInboxService from './conversation-inbox.service.js';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import { ConversationReentryService, REENTRY_PROMPT } from './conversation-reentry.service.js';

const integrationEnabled = isConversationDbEnabled();

async function skipReason() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!integrationEnabled) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const { rows } = await query(
    `SELECT COL_LENGTH('dbo.conversations', 'reentry_json') AS column_length`,
  );
  if (!rows[0]?.column_length) {
    return 'Migration 008_conversation_reentry.sql is not applied';
  }
  return null;
}

async function cleanup(conversationId) {
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

test('integration: cierre humano y texto libre quedan en reentrada, no en welcome', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const created = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-REENTRY-${suffix}`,
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v11',
    currentNodeKey: 'human_handoff',
  });
  const conversation = await conversationRepository.updateConversation(created.id, {
    contactEmail: 'reentry@example.com',
  });
  const handoff = await humanHandoffRepository.createHandoff({
    conversationId: conversation.id,
    requestedBy: 'bot',
    reason: 'human_handoff',
    status: 'assigned',
  });
  await conversationSessionRepository.createSession({
    conversationId: conversation.id,
    flowId: 'main-menu',
    flowVersion: 'v11',
    currentNodeKey: 'human_handoff',
    status: 'paused',
    historyJson: ['welcome', 'no_presenciales_menu'],
    variablesJson: { modalidad: 'presencial' },
    trackingJson: {
      transitionTrail: [{ from: 'no_presenciales_menu', to: 'human_handoff' }],
      visitedNodes: ['welcome', 'no_presenciales_menu'],
      answers: {},
    },
  });

  const previousPolicy = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, {
      resolutionNote: 'integration reentry',
    });
    assert.equal(closed.conversation.status, 'bot');
    assert.equal(closed.conversation.currentNodeKey, null);
    assert.equal(closed.conversation.reentryJson.status, 'pending');
    assert.equal(closed.conversation.reentryJson.resumeNodeKey, 'no_presenciales_menu');
    assert.equal(closed.conversation.contactEmail, 'reentry@example.com');

    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson.status, 'pending');

    const handoffAfter = await humanHandoffRepository.findById(handoff.id);
    assert.equal(handoffAfter.status, 'resolved');

    const first = await reentry.consumeInbound(stored, 'sigo con la misma consulta');
    assert.equal(first.action, 'prompt');
    assert.equal(first.reply, REENTRY_PROMPT);
    const after = await conversationRepository.findById(conversation.id);
    assert.equal(after.currentNodeKey, null);
    assert.equal(after.reentryJson.status, 'awaiting_choice');
    assert.equal(after.status, 'bot');
  } finally {
    if (previousPolicy === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previousPolicy;
    await cleanup(conversation.id);
  }
});

const UNSAFE_NODES = new Set([
  'human_handoff',
  'humano',
  'asesor',
  'representante',
  'fallback_global',
  'fallback',
]);

function resumeNodeOf(flow) {
  return flow.nodes.find((node) => node.id === 'no_presenciales_menu' && String(node.message || '').trim())
    || flow.nodes.find((node) => String(node.message || '').trim() && !UNSAFE_NODES.has(node.id))
    || null;
}

async function openHumanCase({ flow, node, flowVersion }) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const version = flowVersion || flow.version || 'v1';
  const created = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-REENTRY-${suffix}`,
    status: 'assigned',
    currentFlowId: flow.id || 'main-menu',
    currentFlowVersion: version,
    currentNodeKey: 'human_handoff',
  });
  const conversation = await conversationRepository.updateConversation(created.id, {
    contactEmail: 'reentry@example.com',
  });
  const handoff = await humanHandoffRepository.createHandoff({
    conversationId: conversation.id,
    requestedBy: 'bot',
    reason: 'human_handoff',
    status: 'assigned',
  });
  await conversationSessionRepository.createSession({
    conversationId: conversation.id,
    flowId: flow.id || 'main-menu',
    flowVersion: version,
    currentNodeKey: 'human_handoff',
    status: 'paused',
    historyJson: ['welcome', node.id],
    variablesJson: { modalidad: 'presencial' },
    trackingJson: {
      transitionTrail: [{ from: node.id, to: 'human_handoff' }],
      visitedNodes: ['welcome', node.id],
      answers: {},
    },
  });
  return { conversation, handoff, userId: conversation.externalUserId };
}

async function presentEntry(userId, text, flow, conversation) {
  await sessionService.resetSession(userId);
  return new FlowEngine().resolveIncomingMessage({
    userId,
    text,
    flowId: flow.id || 'main-menu',
    flowSnapshot: flow,
    conversationContext: conversation,
  });
}

test('integration: continuar restaura el nodo publicado de la misma versión', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  assert.ok(node, 'el flujo publicado no tiene un nodo de resume');
  const { conversation, userId } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'restore' });
    assert.equal(closed.conversation.reentryJson.resumeNodeKey, node.id);
    assert.equal(closed.conversation.reentryJson.flowVersion, flow.version);
    await reentry.consumeInbound(closed.conversation, 'sigo con la consulta');
    const choice = await reentry.consumeInbound(
      await conversationRepository.findById(conversation.id),
      '1',
    );
    assert.equal(choice.action, 'present_node');
    assert.equal(choice.reason, 'same_version');
    assert.equal(choice.nodeKey, node.id);
    assert.equal(choice.reply, node.message);
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson, null);
    assert.equal(stored.currentNodeKey, node.id);
    assert.equal(stored.currentFlowVersion, flow.version);
    assert.equal(stored.contactEmail, 'reentry@example.com');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await sessionService.resetSession(userId);
    await cleanup(conversation.id);
  }
});

test('integration: nueva consulta presenta el entry y no matchea el comando', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation, userId } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'fresh' });
    await reentry.consumeInbound(closed.conversation, 'texto libre');
    const choice = await reentry.consumeInbound(
      await conversationRepository.findById(conversation.id),
      '2',
    );
    assert.equal(choice.action, 'present_entry');
    const stored = await conversationRepository.findById(conversation.id);
    const presented = await presentEntry(userId, '2', flow, stored);
    assert.equal(/No pude entender/i.test(presented.reply), false);
    assert.equal(UNSAFE_NODES.has(presented.currentNodeId), false);
    assert.notEqual(presented.currentNodeId, node.id === flow.entryNode ? '__unused__' : 'fallback_global');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await sessionService.resetSession(userId);
    await cleanup(conversation.id);
  }
});

test('integration: pedir humano abre un handoff nuevo', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation, handoff } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'human' });
    await reentry.consumeInbound(closed.conversation, 'texto libre');
    const choice = await reentry.consumeInbound(
      await conversationRepository.findById(conversation.id),
      'quiero hablar con una persona',
    );
    assert.equal(choice.action, 'handoff');
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.status, 'waiting_human');
    assert.equal(stored.reentryJson, null);
    const oldHandoff = await humanHandoffRepository.findById(handoff.id);
    assert.equal(oldHandoff.status, 'resolved');
    const active = await humanHandoffRepository.findLatestActiveByConversationId(conversation.id);
    assert.ok(active);
    assert.notEqual(active.id, handoff.id);
    assert.equal(active.status, 'pending');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(conversation.id);
  }
});

test('integration: handoff activo no responde con el prompt', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'active' });
    await conversationRepository.updateConversation(conversation.id, {
      status: 'assigned',
      assignedAgentId: closed.conversation.assignedAgentId,
    });
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson.status, 'pending');
    const result = await reentry.consumeInbound(stored, 'hola');
    assert.equal(result.action, 'human_skip');
    const afterInbound = await conversationRepository.findById(conversation.id);
    assert.equal(afterInbound.reentryJson.status, 'pending');
    assert.equal(afterInbound.status, 'assigned');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(conversation.id);
  }
});

test('integration: dos webhooks distintos dejan un solo awaiting_choice', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'race' });
    const [left, right] = await Promise.all([
      reentry.consumeInbound(closed.conversation, 'primer texto libre'),
      reentry.consumeInbound(closed.conversation, 'segundo texto libre'),
    ]);
    const actions = [left.action, right.action].sort();
    assert.deepEqual(actions, ['prompt', 'reprompt']);
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson.status, 'awaiting_choice');
    assert.equal(stored.reentryJson.invalidAttempts, 1);
    assert.equal(stored.currentNodeKey, null);
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(conversation.id);
  }
});

test('integration: el mismo MessageSid no consume la reentrada dos veces', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const sid = `SM-it-${Date.now()}`;
  const key = webhookDedupe.buildProviderMessageKey('twilio', sid);
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'dedupe' });
    assert.equal(await webhookDedupe.isDuplicate(key), false);
    const first = await reentry.consumeInbound(closed.conversation, 'texto libre');
    await webhookDedupe.markProcessed(key);
    assert.equal(first.action, 'prompt');
    assert.equal(await webhookDedupe.isDuplicate(key), true);
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson.status, 'awaiting_choice');
    assert.equal(stored.reentryJson.invalidAttempts, 0);
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(conversation.id);
  }
});

test('integration: el sync del motor no pisa el cursor con reentrada pendiente', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'sync' });
    const updated = await conversationRepository.updateFlowPositionIfNoReentry(conversation.id, {
      currentFlowId: flow.id || 'main-menu',
      currentFlowVersion: flow.version,
      currentNodeKey: 'fallback_global',
      lastMessageAt: new Date(),
    });
    assert.equal(updated, null);
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.currentNodeKey, null);
    assert.equal(stored.reentryJson.status, 'pending');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(conversation.id);
  }
});

test('integration: la toma manual actual no absorbe una reentrada en bot', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'claim' });
    await assert.rejects(
      () => conversationInboxService.claimConversation(conversation.id, 'agent-future'),
      (error) => error.code === 'CONVERSATION_BOT_ACTIVE',
    );
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.status, 'bot');
    assert.equal(stored.reentryJson.status, 'pending');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(conversation.id);
  }
});

test('integration: REENTRY_POLICY=legacy limpia la reentrada y presenta el entry', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation, userId } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'legacy' });
    process.env.REENTRY_POLICY = 'legacy';
    const rolled = await reentry.consumeInbound(closed.conversation, 'texto que no es opción');
    assert.equal(rolled.action, 'legacy_cleared');
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson, null);
    assert.equal(stored.currentNodeKey, null);
    const presented = await presentEntry(userId, 'texto que no es opción', flow, stored);
    assert.equal(/No pude entender/i.test(presented.reply), false);
    assert.equal(UNSAFE_NODES.has(presented.currentNodeId), false);
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await sessionService.resetSession(userId);
    await cleanup(conversation.id);
  }
});

test('integration: un binario que ignora reentry_json presenta el entry si el cursor es null', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation, userId } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'binary' });
    const stored = await conversationRepository.findById(conversation.id);
    assert.ok(stored.reentryJson);
    assert.equal(stored.currentNodeKey, null);
    const presented = await presentEntry(userId, 'texto libre ignorado por el binario viejo', flow, {
      ...stored,
      reentryJson: null,
    });
    assert.equal(/No pude entender/i.test(presented.reply), false);
    assert.equal(UNSAFE_NODES.has(presented.currentNodeId), false);
    const still = await conversationRepository.findById(conversation.id);
    assert.equal(still.reentryJson.status, 'pending');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await sessionService.resetSession(userId);
    await cleanup(conversation.id);
  }
});

test('integration: una versión histórica que no está en la base reinicia', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation, userId } = await openHumanCase({
    flow,
    node,
    flowVersion: 'v-historica-inexistente',
  });
  const lifecycle = new ConversationBotLifecycleService();
  const reentry = new ConversationReentryService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'old-flow' });
    assert.equal(closed.conversation.reentryJson.flowVersion, 'v-historica-inexistente');
    await reentry.consumeInbound(closed.conversation, 'texto libre');
    const choice = await reentry.consumeInbound(
      await conversationRepository.findById(conversation.id),
      'continuar',
    );
    assert.equal(choice.action, 'present_entry');
    assert.equal(choice.reason, 'historical_unavailable');
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson, null);
    assert.equal(stored.currentNodeKey, null);
    const presented = await presentEntry(userId, 'continuar', flow, stored);
    assert.equal(/No pude entender/i.test(presented.reply), false);
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await sessionService.resetSession(userId);
    await cleanup(conversation.id);
  }
});

test('integration: el contador de intentos sobrevive a una instancia nueva', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const flow = await flowLoader.getFlow('main-menu');
  const node = resumeNodeOf(flow);
  const { conversation } = await openHumanCase({ flow, node });
  const lifecycle = new ConversationBotLifecycleService();
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  try {
    const closed = await lifecycle.returnConversationToBot(conversation, { resolutionNote: 'restart' });
    await new ConversationReentryService().consumeInbound(closed.conversation, 'texto libre');
    const again = await new ConversationReentryService().consumeInbound(
      await conversationRepository.findById(conversation.id),
      'no es una opción',
    );
    assert.equal(again.action, 'reprompt');
    const stored = await conversationRepository.findById(conversation.id);
    assert.equal(stored.reentryJson.invalidAttempts, 1);
    assert.equal(stored.reentryJson.status, 'awaiting_choice');
  } finally {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(conversation.id);
  }
});

after(async () => {
  if (integrationEnabled) await closePool();
});
