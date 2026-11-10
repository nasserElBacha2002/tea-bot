import http from 'http';
import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import twilio from 'twilio';
import '../config.js';
import { config } from '../config.js';
import { closePool, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import { createApp } from '../create-app.js';
import { isManualTakeoverEnabled } from '../utils/manual-takeover-flag.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from '../services/session.service.js';
import { ConversationBotLifecycleService } from '../services/conversation-bot-lifecycle.service.js';

const TOKEN = 'tb005-integration-auth-token';
const BASE = 'https://bot.example';

const previousSheets = config.googleSheetsEnabled;
config.googleSheetsEnabled = false;
let sentinelId = null;

after(async () => {
  if (sentinelId) {
    const { rows } = await query(
      'SELECT id FROM dbo.conversations WHERE id = $1',
      [sentinelId],
    );
    if (!rows[0]) {
      throw new Error('el cleanup alcanzó una conversación preexistente');
    }
  }
  config.googleSheetsEnabled = previousSheets;
  await closePool();
});

function sid(label) {
  return `SM${label}${randomUUID().replace(/-/g, '')}`.slice(0, 40);
}

function phone() {
  return `+5491155${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
}

function signatureFor(url, params) {
  return twilio.getExpectedTwilioSignature(TOKEN, url, params);
}

function restoreEnv(snapshot) {
  config.twilioAuthToken = snapshot.token;
  config.googleSheetsEnabled = false;
  if (snapshot.mode == null) delete process.env.TWILIO_SIGNATURE_MODE;
  else process.env.TWILIO_SIGNATURE_MODE = snapshot.mode;
  if (snapshot.base == null) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = snapshot.base;
  if (snapshot.prefix == null) delete process.env.TWILIO_PUBLIC_PATH_PREFIX;
  else process.env.TWILIO_PUBLIC_PATH_PREFIX = snapshot.prefix;
  if (snapshot.takeover == null) delete process.env.MANUAL_TAKEOVER_ENABLED;
  else process.env.MANUAL_TAKEOVER_ENABLED = snapshot.takeover;
  if (snapshot.reentry == null) delete process.env.REENTRY_POLICY;
  else process.env.REENTRY_POLICY = snapshot.reentry;
}

function useEnv(t, { mode = 'enforce' } = {}) {
  const snapshot = {
    token: config.twilioAuthToken,
    mode: process.env.TWILIO_SIGNATURE_MODE,
    base: process.env.APP_BASE_URL,
    prefix: process.env.TWILIO_PUBLIC_PATH_PREFIX,
    takeover: process.env.MANUAL_TAKEOVER_ENABLED,
    reentry: process.env.REENTRY_POLICY,
  };
  config.twilioAuthToken = TOKEN;
  config.googleSheetsEnabled = false;
  process.env.TWILIO_SIGNATURE_MODE = mode;
  process.env.APP_BASE_URL = BASE;
  delete process.env.TWILIO_PUBLIC_PATH_PREFIX;
  delete process.env.MANUAL_TAKEOVER_ENABLED;
  t.after(() => restoreEnv(snapshot));
}

async function prepare(t) {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) {
    t.skip(isolated);
    return false;
  }
  const identity = await query('SELECT DB_NAME() AS database_name');
  const name = String(identity.rows[0]?.database_name || '');
  assert.equal(name.toLowerCase(), 'tea-bot');
  if (!sentinelId) {
    const { rows } = await query('SELECT TOP 1 id FROM dbo.conversations');
    if (rows[0]?.id) sentinelId = rows[0].id;
  }
  return true;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function post(server, { path, params, rawBody, headers = {} }) {
  const body = rawBody ?? new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      port: server.address().port,
      host: '127.0.0.1',
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function idKey(value) {
  return String(value).toLowerCase();
}

async function idsFor(phoneNumber, externalUserId) {
  const { rows } = await query(
    `SELECT id FROM dbo.conversations
     WHERE phone_number = $1 OR external_user_id = $2`,
    [phoneNumber, externalUserId],
  );
  return rows.map((row) => row.id);
}

async function deleteOwnedConversations(ids, preexistingKeys) {
  for (const id of ids) {
    if (preexistingKeys.has(idKey(id))) {
      throw new Error('cleanup rechazado: el id ya existía antes del test');
    }
    await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [id]);
    await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [id]);
    await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [id]);
    await query('DELETE FROM dbo.conversations WHERE id = $1', [id]);
    await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [String(id)]);
  }
}

async function openFixture(t, phoneNumber, messageIds) {
  const externalUserId = `twilio:whatsapp:${phoneNumber}`;
  const preexisting = await idsFor(phoneNumber, externalUserId);
  const preexistingKeys = new Set(preexisting.map(idKey));
  t.after(async () => {
    const current = await idsFor(phoneNumber, externalUserId);
    const owned = current.filter((id) => !preexistingKeys.has(idKey(id)));
    await deleteOwnedConversations(owned, preexistingKeys);
    const remaining = await idsFor(phoneNumber, externalUserId);
    for (const id of preexisting) {
      assert.equal(remaining.some((item) => idKey(item) === idKey(id)), true);
    }
    for (const messageId of messageIds) {
      await query(
        'DELETE FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
        [messageId],
      );
      await query(
        'DELETE FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
        [`${messageId}:outbound`],
      );
    }
    await sessionService.resetSession(externalUserId);
  });
  return {
    externalUserId,
    async ownedIds() {
      const current = await idsFor(phoneNumber, externalUserId);
      return current.filter((id) => !preexistingKeys.has(idKey(id)));
    },
  };
}

async function eventRows(messageId) {
  const { rows } = await query(
    `SELECT status, attempts
     FROM dbo.provider_webhook_events
     WHERE provider_message_id = $1`,
    [messageId],
  );
  return rows;
}

async function inboundCount(ids) {
  let total = 0;
  for (const id of ids) {
    const { rows } = await query(
      `SELECT COUNT(*) AS total
       FROM dbo.conversation_messages
       WHERE conversation_id = $1 AND direction = N'inbound'`,
      [id],
    );
    total += Number(rows[0]?.total || 0);
  }
  return total;
}

describe('TB-005 firma inbound contra SQL tea-bot', { concurrency: 1 }, () => {
  test('la base conectada es tea-bot y 010 ya esta aplicada', async (t) => {
    if (!await prepare(t)) return;
    const { rows } = await query(
      `SELECT filename, success
       FROM dbo.schema_migrations
       WHERE filename IN (
         N'007_monitoring.sql',
         N'008_conversation_reentry.sql',
         N'009_conversation_status_version.sql',
         N'010_webhook_response_body.sql'
       )`,
    );
    const applied = new Map(rows.map((row) => [row.filename, row.success === true || row.success === 1]));
    assert.equal(applied.get('007_monitoring.sql'), true);
    assert.equal(applied.get('008_conversation_reentry.sql'), true);
    assert.equal(applied.get('010_webhook_response_body.sql'), true);
    assert.equal(applied.has('009_conversation_status_version.sql'), false);
  });

  test('T02 y T03 una firma invalida o ausente no escribe eventos ni mensajes', async (t) => {
    if (!await prepare(t)) return;
    useEnv(t, { mode: 'enforce' });
    const messageId = sid('T02');
    const missingId = sid('T03');
    const from = phone();
    const fixture = await openFixture(t, from, [messageId, missingId]);
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/main-menu';
    const invalid = await post(server, {
      path,
      params: { MessageSid: messageId, From: `whatsapp:${from}`, Body: 'hola' },
      headers: { 'x-twilio-signature': 'invalid-signature' },
    });
    const missing = await post(server, {
      path,
      params: { MessageSid: missingId, From: `whatsapp:${from}`, Body: 'hola' },
    });
    assert.equal(invalid.status, 403);
    assert.equal(missing.status, 403);
    assert.equal((await eventRows(messageId)).length, 0);
    assert.equal((await eventRows(missingId)).length, 0);
    assert.equal((await fixture.ownedIds()).length, 0);
    assert.equal(await inboundCount(await fixture.ownedIds()), 0);
  });

  test('T13 dos firmas validas del mismo MessageSid procesan una sola vez', async (t) => {
    if (!await prepare(t)) return;
    useEnv(t, { mode: 'enforce' });
    const messageId = sid('T13');
    const from = phone();
    const fixture = await openFixture(t, from, [messageId]);
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/main-menu';
    const params = { MessageSid: messageId, From: `whatsapp:${from}`, Body: 'hola' };
    const headers = { 'x-twilio-signature': signatureFor(`${BASE}${path}`, params) };
    const first = await post(server, { path, params, headers });
    const second = await post(server, { path, params, headers });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body, second.body);
    assert.match(first.body, /<Message>/);
    const rows = await eventRows(messageId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'PROCESSED');
    assert.equal(Number(rows[0].attempts), 1);
    const owned = await fixture.ownedIds();
    assert.equal(owned.length, 1);
    assert.equal(await inboundCount(owned), 1);
  });

  test('T14 una firma invalida no consume el MessageSid', async (t) => {
    if (!await prepare(t)) return;
    useEnv(t, { mode: 'enforce' });
    const messageId = sid('T14');
    const from = phone();
    const fixture = await openFixture(t, from, [messageId]);
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/main-menu';
    const params = { MessageSid: messageId, From: `whatsapp:${from}`, Body: 'hola' };
    const rejected = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': 'invalid-signature' },
    });
    assert.equal(rejected.status, 403);
    assert.equal((await eventRows(messageId)).length, 0);
    const accepted = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': signatureFor(`${BASE}${path}`, params) },
    });
    assert.equal(accepted.status, 200);
    assert.match(accepted.body, /<Message>/);
    const rows = await eventRows(messageId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'PROCESSED');
    const owned = await fixture.ownedIds();
    assert.equal(owned.length, 1);
    assert.equal(await inboundCount(owned), 1);
  });

  test('T15 una firma valida permite la reentrada', async (t) => {
    if (!await prepare(t)) return;
    useEnv(t, { mode: 'enforce' });
    process.env.REENTRY_POLICY = 'prompt';
    const messageId = sid('T15');
    const from = phone();
    const fixture = await openFixture(t, from, [messageId]);
    const { externalUserId } = fixture;
    const created = await conversationRepository.createConversation({
      channel: 'whatsapp',
      provider: 'twilio',
      externalUserId,
      phoneNumber: from,
      status: 'assigned',
      currentFlowId: 'main-menu',
      currentFlowVersion: 'v11',
      currentNodeKey: 'human_handoff',
    });
    await conversationRepository.updateConversation(created.id, {
      contactEmail: 'tb005-reentry@example.com',
    });
    const handoff = await humanHandoffRepository.createHandoff({
      conversationId: created.id,
      requestedBy: 'bot',
      reason: 'human_handoff',
      status: 'assigned',
    });
    await conversationSessionRepository.createSession({
      conversationId: created.id,
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
    const closed = await new ConversationBotLifecycleService().returnConversationToBot(
      await conversationRepository.findById(created.id),
      { resolutionNote: 'tb005 reentry' },
    );
    assert.equal(closed.conversation.reentryJson.status, 'pending');
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/main-menu';
    const params = {
      MessageSid: messageId,
      From: `whatsapp:${from}`,
      Body: 'sigo con la misma consulta',
    };
    const response = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': signatureFor(`${BASE}${path}`, params) },
    });
    assert.equal(response.status, 200);
    assert.match(response.body, /consulta anterior/);
    const stored = await conversationRepository.findById(created.id);
    assert.equal(stored.currentNodeKey, null);
    assert.equal(stored.reentryJson.status, 'awaiting_choice');
    assert.equal(stored.status, 'bot');
    const handoffAfter = await humanHandoffRepository.findById(handoff.id);
    assert.equal(handoffAfter.status, 'resolved');
    const rows = await eventRows(messageId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'PROCESSED');
  });

  test('T16 con takeover apagado una firma valida sigue atendiendo en bot', async (t) => {
    if (!await prepare(t)) return;
    useEnv(t, { mode: 'enforce' });
    assert.equal(isManualTakeoverEnabled(), false);
    const messageId = sid('T16');
    const from = phone();
    const fixture = await openFixture(t, from, [messageId]);
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/main-menu';
    const params = { MessageSid: messageId, From: `whatsapp:${from}`, Body: 'hola' };
    const response = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': signatureFor(`${BASE}${path}`, params) },
    });
    assert.equal(response.status, 200);
    assert.notEqual(response.status, 409);
    assert.match(response.body, /<Message>/);
    const owned = await fixture.ownedIds();
    assert.equal(owned.length, 1);
    const { rows } = await query(
      'SELECT status FROM dbo.conversations WHERE id = $1',
      [owned[0]],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'bot');
    assert.equal((await eventRows(messageId))[0].status, 'PROCESSED');
  });

  test('T04 en log una firma invalida se procesa y escribe el turno', async (t) => {
    if (!await prepare(t)) return;
    useEnv(t, { mode: 'log' });
    const messageId = sid('T04');
    const from = phone();
    await openFixture(t, from, [messageId]);
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/main-menu';
    const response = await post(server, {
      path,
      params: { MessageSid: messageId, From: `whatsapp:${from}`, Body: 'hola' },
      headers: { 'x-twilio-signature': 'invalid-signature' },
    });
    assert.equal(response.status, 200);
    assert.match(response.body, /<Message>/);
    const rows = await eventRows(messageId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'PROCESSED');
  });

  test('el cleanup rechaza un id preexistente y no lo borra', async (t) => {
    if (!await prepare(t)) return;
    assert.ok(sentinelId);
    await assert.rejects(
      () => deleteOwnedConversations([sentinelId], new Set([idKey(sentinelId)])),
      /ya existía/,
    );
    const { rows } = await query(
      'SELECT id FROM dbo.conversations WHERE id = $1',
      [sentinelId],
    );
    assert.equal(rows.length, 1);
  });

  test('la app real rechaza la firma del último valor repetido sin escribir el SID', async (t) => {
    if (!await prepare(t)) return;
    useEnv(t, { mode: 'enforce' });
    const messageId = sid('DUP');
    await openFixture(t, `+5491155000000`, [messageId]);
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const requestPath = '/webhooks/twilio/main-menu';
    const rawBody = `MessageSid=${messageId}&Tag=b&Tag=a`;
    const response = await post(server, {
      path: requestPath,
      rawBody,
      headers: {
        'x-twilio-signature': twilio.getExpectedTwilioSignature(
          TOKEN,
          `${BASE}${requestPath}`,
          { MessageSid: messageId, Tag: 'a' },
        ),
      },
    });
    assert.equal(response.status, 403);
    assert.equal((await eventRows(messageId)).length, 0);
  });
});
