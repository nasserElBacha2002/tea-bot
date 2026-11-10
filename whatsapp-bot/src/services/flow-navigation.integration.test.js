import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isConversationDbEnabled, pingDatabase, query, closePool } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import sessionService from './session.service.js';
import { FlowEngine } from './flow-engine.service.js';
import conversationService from './conversation.service.js';
import messagePersistence from './message-persistence.service.js';
import { ConversationReentryService } from './conversation-reentry.service.js';
import { processCanonicalTwilioInbound } from './twilio-inbound-pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productionFlow = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../main-menu.json'), 'utf8'),
);

async function skipReason() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

async function cleanup(conversationId, userId) {
  if (userId) await sessionService.resetSession(userId);
  if (!conversationId) return;
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
  await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [String(conversationId)]);
}

async function openCase(nodeKey, { status = 'bot', reentryJson = null, history = ['si_presenciales_tipo'] } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const userId = `sim:flow-nav-${suffix}`;
  const created = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: userId,
    status,
    currentFlowId: productionFlow.id,
    currentFlowVersion: productionFlow.version,
    currentNodeKey: nodeKey,
  });
  const conversation = await conversationRepository.updateConversation(created.id, {
    contactEmail: 'flow-nav@example.com',
    ...(reentryJson ? { reentryJson } : {}),
  });
  const dbSession = await conversationSessionRepository.createSession({
    conversationId: conversation.id,
    flowId: productionFlow.id,
    flowVersion: productionFlow.version,
    currentNodeKey: nodeKey,
    historyJson: history,
    variablesJson: {},
    status: status === 'assigned' ? 'paused' : 'active',
  });
  await sessionService.resetSession(userId);
  await sessionService.createSession(userId, productionFlow.id, nodeKey, {
    flowVersion: productionFlow.version,
    history,
    simulatorFlowOverride: productionFlow,
  });
  return { conversation, dbSession, userId };
}

test('integration: producción v62 persiste Dirección de estudios y el fallback', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  assert.equal(productionFlow.version, 'v62');
  const opened = await openCase('si_pd_menu');
  t.after(() => cleanup(opened.conversation.id, opened.userId));
  const engine = new FlowEngine();
  const selected = await engine.resolveIncomingMessage({
    userId: opened.userId,
    text: 'Dirección de estudios',
    flowId: productionFlow.id,
    flowSnapshot: productionFlow,
    conversationContext: opened.conversation,
  });
  assert.equal(selected.currentNodeId, 'si_pd_direccion');
  await conversationService.syncSessionFromFlowEngine(
    opened.conversation,
    opened.dbSession,
    opened.userId,
    selected,
  );
  const stored = await conversationRepository.findById(opened.conversation.id);
  const session = await conversationSessionRepository.findActiveByConversationId(opened.conversation.id);
  assert.equal(stored.currentNodeKey, 'si_pd_direccion');
  assert.equal(stored.currentFlowId, 'main-menu');
  assert.equal(stored.currentFlowVersion, 'v62');
  assert.equal(session.currentNodeKey, 'si_pd_direccion');

  await sessionService.updateSession(opened.userId, {
    currentNode: 'si_pd_menu',
    simulatorFlowOverride: productionFlow,
  });
  const first = await engine.resolveIncomingMessage({
    userId: opened.userId,
    text: '¿Mañana hay clases?',
    flowId: productionFlow.id,
    flowSnapshot: productionFlow,
    conversationContext: stored,
  });
  const second = await engine.resolveIncomingMessage({
    userId: opened.userId,
    text: '¿Y el viernes?',
    flowId: productionFlow.id,
    flowSnapshot: productionFlow,
    conversationContext: stored,
  });
  assert.equal(first.currentNodeId, 'si_pd_menu');
  assert.equal(second.currentNodeId, 'si_pd_menu');
  assert.notEqual(first.reply, second.reply);
  await conversationService.syncSessionFromFlowEngine(
    stored,
    session,
    opened.userId,
    second,
  );
  const afterFallback = await conversationSessionRepository.findActiveByConversationId(opened.conversation.id);
  assert.equal(afterFallback.currentNodeKey, 'si_pd_menu');
  assert.equal(afterFallback.variablesJson.unmatchedOptionCount, 2);
});

test('integration: Menú y Atrás persisten el nodo de producción', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const opened = await openCase('si_pd_menu', { history: ['si_presenciales_tipo'] });
  t.after(() => cleanup(opened.conversation.id, opened.userId));
  const engine = new FlowEngine();
  const menu = await engine.resolveIncomingMessage({
    userId: opened.userId,
    text: 'Menú',
    flowId: productionFlow.id,
    flowSnapshot: productionFlow,
    conversationContext: opened.conversation,
  });
  assert.equal(menu.currentNodeId, 'welcome');
  assert.match(menu.reply, /estudiante o egresado/);
  await conversationService.syncSessionFromFlowEngine(
    opened.conversation,
    opened.dbSession,
    opened.userId,
    menu,
  );
  const stored = await conversationRepository.findById(opened.conversation.id);
  assert.equal(stored.currentNodeKey, 'welcome');
  assert.deepEqual(sessionService.getSession(opened.userId).history, []);

  await sessionService.resetSession(opened.userId);
  await sessionService.createSession(opened.userId, productionFlow.id, 'si_pd_direccion', {
    flowVersion: productionFlow.version,
    history: ['si_pd_menu'],
    simulatorFlowOverride: productionFlow,
  });
  const back = await engine.resolveIncomingMessage({
    userId: opened.userId,
    text: 'Atrás',
    flowId: productionFlow.id,
    flowSnapshot: productionFlow,
    conversationContext: stored,
  });
  assert.equal(back.currentNodeId, 'si_pd_menu');
  await conversationService.syncSessionFromFlowEngine(stored, opened.dbSession, opened.userId, back);
  const afterBack = await conversationRepository.findById(opened.conversation.id);
  assert.equal(afterBack.currentNodeKey, 'si_pd_menu');
});

test('integration: una conversación asignada no ejecuta el menú', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const phone = `+54912${suffix}`;
  const userId = `twilio:whatsapp:${phone}`;
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: userId,
    phoneNumber: phone,
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentFlowVersion: productionFlow.version,
    currentNodeKey: 'si_pd_menu',
  });
  await conversationRepository.updateConversation(created.id, {
    assignedAgentId: '00000000-0000-4000-8000-000000000001',
  });
  t.after(() => cleanup(created.id, userId));
  const inbound = await messagePersistence.handleInbound({
    provider: 'twilio',
    flowId: 'main-menu',
    userId,
    phone,
    text: 'Menú',
    messageId: `SM-ASSIGNED-${suffix}`,
    rawPayload: { From: `whatsapp:${phone}`, Body: 'Menú' },
  });
  assert.equal(inbound.skipFlowEngine, true);
  const stored = await conversationRepository.findById(created.id);
  assert.equal(stored.status, 'assigned');
  assert.equal(stored.currentNodeKey, 'si_pd_menu');
});

test('integration: la reentrada pendiente no consume Dirección de estudios ni 3', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const previous = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  const opened = await openCase(null, {
    reentryJson: {
      status: 'pending',
      flowId: productionFlow.id,
      flowVersion: productionFlow.version,
      resumeNodeKey: 'si_pd_menu',
      variables: {},
      history: ['si_presenciales_tipo'],
      tracking: {},
    },
  });
  t.after(async () => {
    if (previous === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previous;
    await cleanup(opened.conversation.id, opened.userId);
  });
  const reentry = new ConversationReentryService();
  const label = await reentry.consumeInbound(opened.conversation, 'Dirección de estudios');
  assert.equal(label.action, 'prompt');
  assert.equal(label.conversation.currentNodeKey, null);
  const number = await reentry.consumeInbound(label.conversation, '3');
  assert.equal(number.action, 'reprompt');
  assert.notEqual(number.nodeKey, 'si_pd_direccion');
  assert.equal(number.conversation.currentNodeKey, null);
});

test('integration: el mismo MessageSid no vuelve a ejecutar la transición', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const phone = `+54911${suffix}`;
  const userId = `twilio:whatsapp:${phone}`;
  const messageId = `SMNAV${suffix}`;
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: userId,
    phoneNumber: phone,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v24',
    currentNodeKey: 'si_pd_menu',
  });
  await conversationRepository.updateConversation(created.id, {
    contactEmail: 'flow-nav@example.com',
  });
  await conversationSessionRepository.createSession({
    conversationId: created.id,
    flowId: 'main-menu',
    flowVersion: 'v24',
    currentNodeKey: 'si_pd_menu',
    historyJson: [],
    status: 'active',
  });
  t.after(() => cleanup(created.id, userId));
  await sessionService.resetSession(userId);
  const event = {
    provider: 'twilio',
    flowId: 'main-menu',
    userId,
    phone,
    text: 'Dirección de estudios',
    messageId,
    rawPayload: { From: `whatsapp:${phone}`, Body: 'Dirección de estudios', MessageSid: messageId },
  };
  const first = await processCanonicalTwilioInbound(event);
  const second = await processCanonicalTwilioInbound(event);
  assert.equal(first.replayed, undefined);
  assert.equal(first.kind, 'bot');
  assert.equal(first.result.currentNodeId, 'si_pd_direccion');
  assert.equal(second.replayed, true);
  assert.equal(second.reply, first.reply);
  const stored = await conversationRepository.findById(created.id);
  assert.equal(stored.currentNodeKey, 'si_pd_direccion');
  const messages = await query(
    `SELECT COUNT(*) AS total FROM dbo.conversation_messages
     WHERE conversation_id = $1 AND direction = N'outbound'`,
    [created.id],
  );
  assert.equal(Number(messages.rows[0].total), 1);
});

test.after(async () => {
  await closePool();
});
