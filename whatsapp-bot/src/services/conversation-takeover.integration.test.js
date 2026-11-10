import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { isConversationDbEnabled, pingDatabase, query, closePool } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import conversationTakeoverService from './conversation-takeover.service.js';
import { resolveAgentIdFromUsername } from '../utils/agent-identity.js';

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
  const { rows } = await query(
    `SELECT COL_LENGTH('dbo.conversations', 'status_version') AS column_length`,
  );
  if (!rows[0]?.column_length) {
    return 'Migration 009_conversation_status_version.sql is not applied on the test database';
  }
  const table = await query(
    `SELECT OBJECT_ID(N'dbo.conversation_operation_requests', N'U') AS object_id`,
  );
  if (!table.rows[0]?.object_id) {
    return 'Migration 009_conversation_status_version.sql is not applied on the test database';
  }
  return null;
}

async function cleanup(conversationId) {
  await query('DELETE FROM dbo.conversation_operation_requests WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

test('integration: toma manual exclusiva en SQL TEST', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const previous = process.env.MANUAL_TAKEOVER_ENABLED;
  process.env.MANUAL_TAKEOVER_ENABLED = 'true';
  const suffix = `${Date.now()}`;
  const created = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-TAKEOVER-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
  await conversationSessionRepository.createSession({
    conversationId: created.id,
    flowId: 'main-menu',
    currentNodeKey: 'welcome',
    status: 'active',
  });

  const ana = {
    agentId: resolveAgentIdFromUsername('ana-test'),
    username: 'ana-test',
    role: 'admin',
  };
  const luis = {
    agentId: resolveAgentIdFromUsername('luis-test'),
    username: 'luis-test',
    role: 'conversations_only',
  };

  try {
    const taken = await conversationTakeoverService.takeover({
      conversationId: created.id,
      actor: ana,
      clientRequestId: `it-${suffix}`,
    });
    assert.equal(taken.conversation.status, 'assigned');
    assert.equal(taken.idempotent, false);

    const again = await conversationTakeoverService.takeover({
      conversationId: created.id,
      actor: ana,
      clientRequestId: `it-${suffix}`,
    });
    assert.equal(again.idempotent, true);

    await assert.rejects(
      () => conversationTakeoverService.takeover({
        conversationId: created.id,
        actor: luis,
      }),
      (error) => error.code === 'CONVERSATION_OWNED',
    );

    const stored = await conversationRepository.findById(created.id);
    assert.equal(stored.status, 'assigned');
    assert.equal(stored.assignedAgentId, ana.agentId);
    assert.equal(stored.reentryJson, null);
    assert.ok(Number(stored.statusVersion) >= 1);

    const active = await humanHandoffRepository.findActiveByConversationId(created.id);
    assert.equal(active.length, 1);
    assert.equal(active[0].status, 'assigned');
  } finally {
    if (previous === undefined) delete process.env.MANUAL_TAKEOVER_ENABLED;
    else process.env.MANUAL_TAKEOVER_ENABLED = previous;
    await cleanup(created.id);
  }
});

after(async () => {
  if (isolatedTestDatabaseReason() == null && isConversationDbEnabled()) {
    await closePool();
  }
});

test('integration: dos agentes en paralelo sobre SQL real', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }

  const previous = process.env.MANUAL_TAKEOVER_ENABLED;
  process.env.MANUAL_TAKEOVER_ENABLED = 'true';
  const suffix = `${Date.now()}-race`;
  const created = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-TAKEOVER-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
  const ana = {
    agentId: resolveAgentIdFromUsername('ana-test'),
    username: 'ana-test',
    role: 'admin',
  };
  const luis = {
    agentId: resolveAgentIdFromUsername('luis-test'),
    username: 'luis-test',
    role: 'conversations_only',
  };

  try {
    const [first, second] = await Promise.allSettled([
      conversationTakeoverService.takeover({
        conversationId: created.id,
        actor: ana,
        clientRequestId: `it-a-${suffix}`,
      }),
      conversationTakeoverService.takeover({
        conversationId: created.id,
        actor: luis,
        clientRequestId: `it-b-${suffix}`,
      }),
    ]);
    const ok = [first, second].filter((item) => item.status === 'fulfilled');
    const denied = [first, second].filter((item) => item.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(denied.length, 1);
    assert.equal(denied[0].reason.code, 'CONVERSATION_OWNED');
    const stored = await conversationRepository.findById(created.id);
    assert.equal(stored.status, 'assigned');
    assert.ok(stored.assignedAgentId === ana.agentId || stored.assignedAgentId === luis.agentId);
  } finally {
    if (previous === undefined) delete process.env.MANUAL_TAKEOVER_ENABLED;
    else process.env.MANUAL_TAKEOVER_ENABLED = previous;
    await cleanup(created.id);
  }
});
 