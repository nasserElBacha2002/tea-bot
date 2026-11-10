import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isConversationDbEnabled, pingDatabase, query, closePool } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import { agentsMatch, resolveAgentIdFromUsername } from '../utils/agent-identity.js';
import { exclusiveAgentIdentityConflict } from '../utils/exclusive-agent-identity.js';

const workerPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/takeover-distributed-worker.js',
);
const botRoot = path.resolve(path.dirname(workerPath), '..');

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
  if (!rows[0]?.column_length) return 'Migration 009 is not applied on the test database';
  return null;
}

function assertDistinctAgents() {
  const ana = resolveAgentIdFromUsername('dist-ana');
  const luis = resolveAgentIdFromUsername('dist-luis');
  if (ana === luis || exclusiveAgentIdentityConflict()) {
    throw new Error('SHARED_AGENT_IDENTITY: las dos cuentas resuelven el mismo agente. La prueba de exclusividad no es válida.');
  }
  return { ana, luis };
}

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ...args], {
      cwd: botRoot,
      env: {
        ...process.env,
        MANUAL_TAKEOVER_ENABLED: 'true',
        REENTRY_POLICY: 'prompt',
        ADMIN_USERNAME: 'dist-ana',
        ADMIN_PASSWORD_HASH: 'ab'.repeat(32),
        CONVERSATIONS_OPERATOR_USERNAME: 'dist-luis',
        CONVERSATIONS_OPERATOR_PASSWORD_HASH: 'cd'.repeat(32),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      const line = stdout.split('\n').find((item) => item.startsWith('RESULT '));
      if (!line) {
        reject(new Error(`worker sin resultado (exit ${code})`));
        return;
      }
      resolve(JSON.parse(line.slice('RESULT '.length)));
    });
  });
}

async function cleanup(conversationId) {
  await query('DELETE FROM dbo.conversation_operation_requests WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

test('integration: dos procesos toman la misma conversación en SQL TEST', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const ids = assertDistinctAgents();
  const suffix = `${Date.now()}-dist`;
  const created = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-DIST-${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  try {
    const [ana, luis] = await Promise.all([
      runWorker([created.id, 'dist-ana', 'admin', `dist-a-${suffix}`]),
      runWorker([created.id, 'dist-luis', 'conversations_only', `dist-b-${suffix}`]),
    ]);
    const reports = [ana, luis];
    const accepted = reports.filter((item) => item.ok);
    const rejected = reports.filter((item) => !item.ok);
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].code, 'CONVERSATION_OWNED');
    assert.notEqual(ana.agentId, luis.agentId);
    assert.equal(ana.agentId, ids.ana);
    assert.equal(luis.agentId, ids.luis);

    const stored = await conversationRepository.findById(created.id);
    assert.equal(stored.status, 'assigned');
    assert.equal(agentsMatch(stored.assignedAgentId, accepted[0].agentId), true);
    assert.equal(agentsMatch(stored.assignedAgentId, rejected[0].agentId), false);

    const active = await humanHandoffRepository.findActiveByConversationId(created.id);
    assert.equal(active.length, 1);
    assert.equal(agentsMatch(active[0].assignedAgentId, accepted[0].agentId), true);

    const messages = await query(
      `SELECT COUNT(*) AS total
       FROM dbo.conversation_messages
       WHERE conversation_id = $1
         AND sender_type = 'system'
         AND body LIKE '%tomó la conversación%'`,
      [created.id],
    );
    assert.equal(Number(messages.rows[0].total), 1);

    const winnerEvents = accepted[0].events.filter((event) => event.type === 'conversation.assigned');
    const loserEvents = rejected[0].events.filter((event) => event.type === 'conversation.assigned');
    assert.equal(winnerEvents.length, 1);
    assert.equal(agentsMatch(winnerEvents[0].assignedAgentId, accepted[0].agentId), true);
    assert.equal(loserEvents.length, 0);

    const winner = accepted[0];
    const loser = rejected[0];
    const reply = await runWorker([
      created.id,
      winner.username,
      winner.role,
      `dist-reply-${suffix}`,
      'reply',
    ]);
    assert.equal(reply.ok, true, reply.code);
    const denied = await runWorker([
      created.id,
      loser.username,
      loser.role,
      `dist-reply-denied-${suffix}`,
      'reply',
    ]);
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'CONVERSATION_OWNED');
    const returned = await runWorker([
      created.id,
      winner.username,
      winner.role,
      `dist-return-${suffix}`,
      'return',
    ]);
    assert.equal(returned.ok, true, returned.code);
    const afterReturn = await conversationRepository.findById(created.id);
    assert.equal(afterReturn.status, 'bot');
    assert.equal(afterReturn.assignedAgentId, null);
    assert.equal(afterReturn.reentryJson?.status, 'pending');
    const activeAfter = await humanHandoffRepository.findActiveByConversationId(created.id);
    assert.equal(activeAfter.length, 0);
    const replies = await query(
      `SELECT COUNT(*) AS total
       FROM dbo.conversation_messages
       WHERE conversation_id = $1
         AND sender_type = 'agent'`,
      [created.id],
    );
    assert.equal(Number(replies.rows[0].total), 1);
  } finally {
    await cleanup(created.id);
  }
});

after(async () => {
  if (isolatedTestDatabaseReason() == null && isConversationDbEnabled()) {
    await closePool();
  }
});
