import http from 'node:http';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { createApp } from '../create-app.js';
import { closePool, isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import { createSignedSessionToken } from './admin-auth.service.js';
import { resolveAgentIdFromUsername } from '../utils/agent-identity.js';
import { exclusiveAgentIdentityConflict } from '../utils/exclusive-agent-identity.js';
import { ROLES } from '../auth/roles.js';

const ADMIN_USER = 'tb-return-admin';
const OPERATOR_USER = 'tb-return-operator';
const HASH_A = 'ab'.repeat(32);
const HASH_B = 'cd'.repeat(32);

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

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function request(server, { method = 'POST', path, cookie, body }) {
  const payload = body == null ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      port: server.address().port,
      host: '127.0.0.1',
      path,
      method,
      headers: {
        cookie,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = { raw };
        }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function cookieFor(username, role) {
  const token = createSignedSessionToken(username, config.sessionSecret, role);
  return `tea_session=${token}`;
}

async function createBotConversation(label) {
  return conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `IT-RETURN-${label}-${Date.now()}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
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

function usePanelAccounts() {
  const saved = {
    adminUsername: config.adminUsername,
    adminPasswordHash: config.adminPasswordHash,
    conversationsOperatorUsername: config.conversationsOperatorUsername,
    conversationsOperatorPasswordHash: config.conversationsOperatorPasswordHash,
    takeover: process.env.MANUAL_TAKEOVER_ENABLED,
    reentry: process.env.REENTRY_POLICY,
  };
  config.adminUsername = ADMIN_USER;
  config.adminPasswordHash = HASH_A;
  config.conversationsOperatorUsername = OPERATOR_USER;
  config.conversationsOperatorPasswordHash = HASH_B;
  return () => {
    config.adminUsername = saved.adminUsername;
    config.adminPasswordHash = saved.adminPasswordHash;
    config.conversationsOperatorUsername = saved.conversationsOperatorUsername;
    config.conversationsOperatorPasswordHash = saved.conversationsOperatorPasswordHash;
    if (saved.takeover === undefined) delete process.env.MANUAL_TAKEOVER_ENABLED;
    else process.env.MANUAL_TAKEOVER_ENABLED = saved.takeover;
    if (saved.reentry === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = saved.reentry;
  };
}

test('integration: HTTP real de cierre y devolución con dos cuentas', async (t) => {
  const reason = await skipReason();
  if (reason) {
    t.skip(reason);
    return;
  }
  const adminId = resolveAgentIdFromUsername(ADMIN_USER);
  const operatorId = resolveAgentIdFromUsername(OPERATOR_USER);
  if (adminId === operatorId || exclusiveAgentIdentityConflict({
    ADMIN_USERNAME: ADMIN_USER,
    CONVERSATIONS_OPERATOR_USERNAME: OPERATOR_USER,
    INTERNAL_AGENT_ID: process.env.INTERNAL_AGENT_ID,
  })) {
    throw new Error('SHARED_AGENT_IDENTITY: las dos cuentas resuelven el mismo agente. La prueba de exclusividad no es válida.');
  }

  const restore = usePanelAccounts();
  process.env.MANUAL_TAKEOVER_ENABLED = 'true';
  process.env.REENTRY_POLICY = 'prompt';
  const server = await listen(createApp());
  const adminCookie = cookieFor(ADMIN_USER, ROLES.ADMIN);
  const operatorCookie = cookieFor(OPERATOR_USER, ROLES.CONVERSATIONS_ONLY);
  const owned = await createBotConversation('owned');
  const adminFree = await createBotConversation('admin-free');
  const shared = await createBotConversation('shared');
  const race = await createBotConversation('race');

  try {
    const operatorBot = await request(server, {
      method: 'GET',
      path: `/api/conversations/${owned.id}`,
      cookie: operatorCookie,
    });
    assert.equal(operatorBot.body?.data?.conversation?.status, 'bot');
    assert.equal(operatorBot.body?.data?.conversation?.canTakeover, true);

    const adminBot = await request(server, {
      method: 'GET',
      path: `/api/conversations/${adminFree.id}`,
      cookie: adminCookie,
    });
    assert.equal(adminBot.body?.data?.conversation?.canTakeover, true);

    const taken = await request(server, {
      path: `/api/conversations/${owned.id}/takeover`,
      cookie: operatorCookie,
      body: { clientRequestId: `http-own-${owned.id}` },
    });
    assert.equal(taken.status, 200, JSON.stringify(taken.body));
    assert.equal(taken.body?.data?.conversation?.assignedAgentId, operatorId);

    const adminTaken = await request(server, {
      path: `/api/conversations/${adminFree.id}/takeover`,
      cookie: adminCookie,
      body: { clientRequestId: `http-admin-free-${adminFree.id}` },
    });
    assert.equal(adminTaken.status, 200, JSON.stringify(adminTaken.body));
    assert.equal(adminTaken.body?.data?.conversation?.status, 'assigned');
    assert.equal(adminTaken.body?.data?.conversation?.assignedAgentId, adminId);

    const ownerView = await request(server, {
      method: 'GET',
      path: `/api/conversations/${owned.id}`,
      cookie: operatorCookie,
    });
    assert.equal(ownerView.body?.data?.conversation?.canReturnToBot, true);
    assert.equal(ownerView.body?.data?.conversation?.canForceReturn, false);

    const adminView = await request(server, {
      method: 'GET',
      path: `/api/conversations/${owned.id}`,
      cookie: adminCookie,
    });
    assert.equal(adminView.body?.data?.conversation?.canReturnToBot, false);
    assert.equal(adminView.body?.data?.conversation?.canForceReturn, false);
    assert.equal(adminView.body?.data?.conversation?.canReassign, true);

    const adminClose = await request(server, {
      path: `/api/conversations/${owned.id}/close`,
      cookie: adminCookie,
      body: {},
    });
    assert.equal(adminClose.status, 409);
    assert.equal(adminClose.body?.error, 'CONVERSATION_OWNED');

    const adminReturn = await request(server, {
      path: `/api/conversations/${owned.id}/return-to-bot`,
      cookie: adminCookie,
      body: {},
    });
    assert.equal(adminReturn.status, 409);
    assert.equal(adminReturn.body?.error, 'CONVERSATION_OWNED');

    const adminReply = await request(server, {
      path: `/api/conversations/${owned.id}/messages`,
      cookie: adminCookie,
      body: { body: 'intento del administrador' },
    });
    assert.equal(adminReply.status, 409);
    assert.equal(adminReply.body?.error, 'CONVERSATION_OWNED');

    const ownerReply = await request(server, {
      path: `/api/conversations/${owned.id}/messages`,
      cookie: operatorCookie,
      body: { body: 'respuesta del propietario' },
    });
    assert.equal(ownerReply.status, 201, JSON.stringify(ownerReply.body));

    const stillOwned = await conversationRepository.findById(owned.id);
    assert.equal(stillOwned.status, 'assigned');
    assert.equal(stillOwned.assignedAgentId, operatorId);

    const ownerReturn = await request(server, {
      path: `/api/conversations/${owned.id}/return-to-bot`,
      cookie: operatorCookie,
      body: {},
    });
    assert.equal(ownerReturn.status, 200, JSON.stringify(ownerReturn.body));
    const returned = await conversationRepository.findById(owned.id);
    assert.equal(returned.status, 'bot');
    assert.equal(returned.assignedAgentId, null);
    assert.equal(returned.reentryJson?.status, 'pending');

    const secondClose = await request(server, {
      path: `/api/conversations/${owned.id}/close`,
      cookie: operatorCookie,
      body: {},
    });
    assert.equal(secondClose.status, 200, JSON.stringify(secondClose.body));
    const closedAgain = await conversationRepository.findById(owned.id);
    assert.equal(closedAgain.status, 'bot');
    assert.equal(closedAgain.assignedAgentId, null);

    const retaken = await request(server, {
      path: `/api/conversations/${owned.id}/takeover`,
      cookie: operatorCookie,
      body: { clientRequestId: `http-own-2-${owned.id}` },
    });
    assert.equal(retaken.status, 200, JSON.stringify(retaken.body));

    const forced = await request(server, {
      path: `/api/conversations/${owned.id}/close`,
      cookie: adminCookie,
      body: { force: true },
    });
    assert.equal(forced.status, 409);
    assert.equal(forced.body?.error, 'CONVERSATION_OWNED');
    const forcedRow = await conversationRepository.findById(owned.id);
    assert.equal(forcedRow.status, 'assigned');
    assert.equal(forcedRow.assignedAgentId, operatorId);

    const operatorTransfer = await request(server, {
      path: `/api/conversations/${owned.id}/transfer`,
      cookie: operatorCookie,
      body: { targetUsername: ADMIN_USER, reason: 'el operador no reasigna' },
    });
    assert.equal(operatorTransfer.status, 403);
    assert.equal(operatorTransfer.body?.error, 'FORBIDDEN');

    const reassigned = await request(server, {
      path: `/api/conversations/${owned.id}/transfer`,
      cookie: adminCookie,
      body: { targetUsername: ADMIN_USER, reason: 'intervención administrativa explícita' },
    });
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned.body));
    const reassignedRow = await conversationRepository.findById(owned.id);
    assert.equal(reassignedRow.status, 'assigned');
    assert.equal(reassignedRow.assignedAgentId, adminId);
    const audit = await query(
      `SELECT action FROM dbo.audit_logs WHERE entity_id = $1 AND action = N'manual_reassign'`,
      [owned.id],
    );
    assert.equal(audit.rows.length, 1);

    const otherClose = await request(server, {
      path: `/api/conversations/${owned.id}/close`,
      cookie: operatorCookie,
      body: {},
    });
    assert.equal(otherClose.status, 409);
    assert.equal(otherClose.body?.error, 'CONVERSATION_OWNED');

    const otherReply = await request(server, {
      path: `/api/conversations/${owned.id}/messages`,
      cookie: operatorCookie,
      body: { body: 'el dueño anterior ya no responde' },
    });
    assert.equal(otherReply.status, 409);
    assert.equal(otherReply.body?.error, 'CONVERSATION_OWNED');

    const newOwnerReply = await request(server, {
      path: `/api/conversations/${owned.id}/messages`,
      cookie: adminCookie,
      body: { body: 'respuesta después de reasignar' },
    });
    assert.equal(newOwnerReply.status, 201, JSON.stringify(newOwnerReply.body));

    const otherReturn = await request(server, {
      path: `/api/conversations/${owned.id}/return-to-bot`,
      cookie: operatorCookie,
      body: {},
    });
    assert.equal(otherReturn.status, 409);
    assert.equal(otherReturn.body?.error, 'CONVERSATION_OWNED');
    const untouched = await conversationRepository.findById(owned.id);
    assert.equal(untouched.status, 'assigned');
    assert.equal(untouched.assignedAgentId, adminId);

    const sharedTake = await request(server, {
      path: `/api/conversations/${shared.id}/takeover`,
      cookie: operatorCookie,
      body: { clientRequestId: `http-shared-${shared.id}` },
    });
    assert.equal(sharedTake.status, 200, JSON.stringify(sharedTake.body));
    process.env.MANUAL_TAKEOVER_ENABLED = 'false';
    const sharedClose = await request(server, {
      path: `/api/conversations/${shared.id}/close`,
      cookie: adminCookie,
      body: {},
    });
    assert.equal(sharedClose.status, 200, JSON.stringify(sharedClose.body));
    const sharedRow = await conversationRepository.findById(shared.id);
    assert.equal(sharedRow.status, 'bot');
    assert.equal(sharedRow.assignedAgentId, null);

    process.env.MANUAL_TAKEOVER_ENABLED = 'true';
    const raceTake = await request(server, {
      path: `/api/conversations/${race.id}/takeover`,
      cookie: operatorCookie,
      body: { clientRequestId: `http-race-${race.id}` },
    });
    assert.equal(raceTake.status, 200, JSON.stringify(raceTake.body));
    const [raceReturn, raceTransfer] = await Promise.all([
      request(server, {
        path: `/api/conversations/${race.id}/return-to-bot`,
        cookie: operatorCookie,
        body: {},
      }),
      request(server, {
        path: `/api/conversations/${race.id}/transfer`,
        cookie: adminCookie,
        body: { targetUsername: ADMIN_USER, reason: 'cambio concurrente de prueba' },
      }),
    ]);
    const outcomes = [raceReturn, raceTransfer];
    assert.equal(outcomes.filter((item) => item.status === 200).length, 1);
    assert.equal(outcomes.filter((item) => item.status === 409).length, 1);
    const raceRow = await conversationRepository.findById(race.id);
    if (raceReturn.status === 200) {
      assert.equal(raceTransfer.status, 409);
      assert.equal(raceRow.status, 'bot');
      assert.equal(raceRow.assignedAgentId, null);
    } else {
      assert.equal(raceTransfer.status, 200);
      assert.equal(raceReturn.body?.error, 'CONVERSATION_OWNED');
      assert.equal(raceRow.status, 'assigned');
      assert.equal(raceRow.assignedAgentId, adminId);
    }
  } finally {
    await closeServer(server);
    await cleanup(owned.id);
    await cleanup(adminFree.id);
    await cleanup(shared.id);
    await cleanup(race.id);
    restore();
  }
});

after(async () => {
  if (isolatedTestDatabaseReason() == null && isConversationDbEnabled()) {
    await closePool();
  }
});
