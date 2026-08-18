import test from 'node:test';
import assert from 'node:assert/strict';
import { isConversationDbEnabled, pingDatabase, query, closePool } from '../db/index.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import { HumanHandoffService } from './human-handoff.service.js';
import { ConversationReopenService } from './conversation-reopen.service.js';
import { withTransaction } from '../db/index.js';
import { isHandoffTerminalNode } from '../utils/conversation-handoff-policy.js';
import { WELCOME_NODE_ID } from '../constants/contact-email-flow.js';

const integrationEnabled = isConversationDbEnabled();

async function skipIfNoDb() {
  if (!integrationEnabled) return true;
  const ping = await pingDatabase();
  return !ping.ok;
}

async function createFixture() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-${suffix}`,
    phoneNumber: null,
    displayName: `Integration ${suffix}`,
    status: 'assigned',
    assignedAgentId: null,
    currentFlowId: 'main-menu',
    currentNodeKey: 'human_handoff',
    contactEmail: 'integration@example.com',
  });

  const handoff = await humanHandoffRepository.createHandoff({
    conversationId: conversation.id,
    requestedBy: 'bot',
    reason: 'human_handoff',
    status: 'assigned',
    assignedAgentId: null,
  });

  const session = await conversationSessionRepository.createSession({
    conversationId: conversation.id,
    flowId: 'main-menu',
    currentNodeKey: 'human_handoff',
    status: 'paused',
  });

  return { conversation, handoff, session, suffix };
}

async function cleanupFixture(conversationId) {
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

test('integration: returnConversationToBot deja estado coherente', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const { conversation, handoff, session } = await createFixture();
  const service = new ConversationBotLifecycleService();

  try {
    const result = await service.returnConversationToBot(conversation, {
      resolutionNote: 'integration test',
    });

    assert.equal(result.conversation.status, 'bot');
    assert.equal(result.conversation.assignedAgentId, null);
    assert.notEqual(result.conversation.currentNodeKey, 'human_handoff');
    assert.equal(isHandoffTerminalNode(result.conversation.currentNodeKey), false);

    const handoffAfter = await humanHandoffRepository.findById(handoff.id);
    assert.equal(handoffAfter.status, 'resolved');

    const sessionAfter = await conversationSessionRepository.findLatestByConversationId(conversation.id);
    assert.equal(sessionAfter.id, session.id);
    assert.equal(sessionAfter.status, 'ended');
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test('integration: rollback mantiene handoff activo si falla antes del commit', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const { conversation, handoff } = await createFixture();

  try {
    await assert.rejects(async () => {
      await withTransaction(async (transaction) => {
        await humanHandoffRepository.resolveActiveHandoffs(
          conversation.id,
          { resolutionNote: 'should rollback' },
          { transaction },
        );
        throw new Error('simulate failure before commit');
      });
    });

    const handoffAfter = await humanHandoffRepository.findById(handoff.id);
    assert.equal(handoffAfter.status, 'assigned');

    const convAfter = await conversationRepository.findById(conversation.id);
    assert.equal(convAfter.status, 'assigned');
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test('integration: ensurePendingHandoff concurrente crea un solo handoff activo', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-RACE-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: WELCOME_NODE_ID,
    contactEmail: 'race@example.com',
  });

  const service = new HumanHandoffService();

  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.ensurePendingHandoff(conversation, { requestedBy: 'bot', reason: 'race' }),
      ),
    );

    const createdCount = results.filter((r) => r.created).length;
    assert.equal(createdCount, 1);

    const active = await humanHandoffRepository.findActiveByConversationId(conversation.id);
    assert.equal(active.length, 1);
    assert.equal(active[0].status, 'pending');
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test('integration: double close es idempotente', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const { conversation } = await createFixture();
  const service = new ConversationBotLifecycleService();

  try {
    await Promise.all([
      service.returnConversationToBot(conversation, { resolutionNote: 'close-1' }),
      service.returnConversationToBot(conversation, { resolutionNote: 'close-2' }),
    ]);

    const convAfter = await conversationRepository.findById(conversation.id);
    assert.equal(convAfter.status, 'bot');
    assert.equal(convAfter.assignedAgentId, null);

    const active = await humanHandoffRepository.findActiveByConversationId(conversation.id);
    assert.equal(active.length, 0);
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test('integration: normalizeLegacy vs requestHumanHandoff concurrente mantiene coherencia', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-NORM-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'human_handoff',
    contactEmail: 'norm@example.com',
  });

  await conversationSessionRepository.createSession({
    conversationId: conversation.id,
    flowId: 'main-menu',
    currentNodeKey: 'human_handoff',
    status: 'paused',
  });

  const lifecycleService = new ConversationBotLifecycleService();
  const handoffService = new HumanHandoffService();

  try {
    await Promise.all([
      lifecycleService.normalizeLegacyBotStateIfNeeded(conversation),
      handoffService.requestHumanHandoff(conversation, {
        engineResult: {
          currentNodeId: 'human_handoff',
          flowId: 'main-menu',
          terminalReason: 'human_handoff',
        },
        dbSession: null,
      }),
    ]);

    const convAfter = await conversationRepository.findById(conversation.id);
    const active = await humanHandoffRepository.findActiveByConversationId(conversation.id);

    if (active.length > 0) {
      assert.equal(convAfter.status, 'waiting_human');
      assert.equal(isHandoffTerminalNode(convAfter.currentNodeKey), true);
    } else {
      assert.equal(convAfter.status, 'bot');
      assert.equal(isHandoffTerminalNode(convAfter.currentNodeKey), false);
    }

    assert.ok(active.length <= 1);
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test('integration: requestHumanHandoff hace rollback completo si falla antes del commit', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-ROLLBACK-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: WELCOME_NODE_ID,
    contactEmail: 'rollback@example.com',
  });

  const session = await conversationSessionRepository.createSession({
    conversationId: conversation.id,
    flowId: 'main-menu',
    currentNodeKey: WELCOME_NODE_ID,
    status: 'active',
  });

  const failingService = new HumanHandoffService({
    handoffRepo: humanHandoffRepository,
    conversationRepo: {
      findByIdForUpdate: (...args) => conversationRepository.findByIdForUpdate(...args),
      updateConversation: async () => {
        throw new Error('simulate failure after handoff ensure');
      },
    },
    sessionRepo: conversationSessionRepository,
    runTransaction: withTransaction,
  });

  try {
    await assert.rejects(async () => {
      await failingService.requestHumanHandoff(conversation, {
        engineResult: {
          currentNodeId: 'human_handoff',
          flowId: 'main-menu',
          terminalReason: 'human_handoff',
        },
        dbSession: session,
      });
    });

    const convAfter = await conversationRepository.findById(conversation.id);
    assert.equal(convAfter.status, 'bot');

    const active = await humanHandoffRepository.findActiveByConversationId(conversation.id);
    assert.equal(active.length, 0);

    const sessionAfter = await conversationSessionRepository.findActiveByConversationId(
      conversation.id,
    );
    assert.equal(sessionAfter.status, 'active');
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test('integration: estado inconsistente bot + handoff pending no normaliza', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-DEF-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'human_handoff',
    contactEmail: 'defensive@example.com',
  });

  await humanHandoffRepository.createHandoff({
    conversationId: conversation.id,
    requestedBy: 'bot',
    reason: 'human_handoff',
    status: 'pending',
  });

  const lifecycleService = new ConversationBotLifecycleService();

  try {
    const result = await lifecycleService.normalizeLegacyBotStateIfNeeded(conversation);
    assert.equal(result.normalized, false);

    const convAfter = await conversationRepository.findById(conversation.id);
    assert.equal(convAfter.status, 'bot');
    assert.equal(convAfter.currentNodeKey, 'human_handoff');

    const active = await humanHandoffRepository.findActiveByConversationId(conversation.id);
    assert.equal(active.length, 1);
    assert.equal(active[0].status, 'pending');
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test('integration: reopen assigned preserva assignedAgentId', async (t) => {
  if (await skipIfNoDb()) {
    t.skip('Conversation DB unavailable');
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const agentId = '00000000-0000-4000-8000-000000000099';
  const conversation = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-REOPEN-${suffix}`,
    status: 'closed',
    closedAt: new Date(),
    currentFlowId: 'main-menu',
    currentNodeKey: 'human_handoff',
    contactEmail: 'reopen@example.com',
  });

  await humanHandoffRepository.createHandoff({
    conversationId: conversation.id,
    requestedBy: 'bot',
    reason: 'human_handoff',
    status: 'assigned',
    assignedAgentId: agentId,
  });

  const reopenService = new ConversationReopenService({
    audit: { record: async () => {} },
  });

  try {
    const result = await reopenService.reopenFromInboundMessage(conversation);
    assert.equal(result.reopened, true);
    assert.equal(result.conversation.status, 'assigned');
    assert.equal(result.conversation.assignedAgentId, agentId);
  } finally {
    await cleanupFixture(conversation.id);
  }
});

test.after(async () => {
  if (integrationEnabled) {
    await closePool();
  }
});
