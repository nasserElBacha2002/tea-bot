import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../config.js';
import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import messagePersistence from '../services/message-persistence.service.js';
import sessionService from '../services/session.service.js';
import { processCanonicalTwilioInbound } from '../services/twilio-inbound-pipeline.js';
import { settleTwilioInbound } from '../controllers/twilio-webhook.controller.js';
import { withInboundLease } from './inbound-lease.js';
import { acquireInboundProcessing } from './monitoring.repository.js';
import { beginInboundEvent, finishInboundEvent, twilioTurnOutboundId } from './webhook-events.service.js';

async function dbUnavailable() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const columns = await query(
    `SELECT
       COL_LENGTH(N'dbo.provider_webhook_events', N'updated_at') AS updated_at,
       COL_LENGTH(N'dbo.provider_webhook_events', N'response_body') AS response_body,
       COL_LENGTH(N'dbo.conversations', N'reentry_json') AS reentry_json`,
  );
  const row = columns.rows[0] || {};
  if (row.updated_at == null) return 'provider_webhook_events.updated_at no está en la base de prueba';
  if (row.response_body == null) return 'provider_webhook_events.response_body no está en la base de prueba';
  if (row.reentry_json == null) return 'conversations.reentry_json no está en la base de prueba';
  return null;
}

function sid(label) {
  return `SM-D427-${label}-${randomUUID()}`;
}

function phone() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
  return `+54911${suffix}`;
}

function inboundBody(messageId, from, text = 'hola') {
  return {
    MessageSid: messageId,
    From: `whatsapp:${from}`,
    Body: text,
    NumMedia: '0',
  };
}

async function deleteEvent(messageId) {
  await query(
    'DELETE FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
    [messageId],
  );
}

async function deleteConversation(conversationId) {
  if (!conversationId) return;
  await query('DELETE FROM dbo.conversation_operation_requests WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.audit_logs WHERE entity_id = $1', [String(conversationId)]);
  await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.human_handoffs WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversation_messages WHERE conversation_id = $1', [conversationId]);
  await query('DELETE FROM dbo.conversations WHERE id = $1', [conversationId]);
}

async function eventRow(messageId) {
  const { rows } = await query(
    `SELECT status, attempts, response_body
     FROM dbo.provider_webhook_events
     WHERE provider_message_id = $1`,
    [messageId],
  );
  return rows[0] || null;
}

async function messageCounts(conversationId) {
  const { rows } = await query(
    `SELECT direction, COUNT(*) AS total
     FROM dbo.conversation_messages
     WHERE conversation_id = $1
     GROUP BY direction`,
    [conversationId],
  );
  const counts = { inbound: 0, outbound: 0 };
  for (const row of rows) counts[row.direction] = Number(row.total);
  return counts;
}

function replyTurn(text) {
  return { kind: 'bot', reply: text, replyAuthorized: true };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function openBarrier(parties) {
  let arrived = 0;
  let release;
  const opened = new Promise((done) => {
    release = done;
  });
  return async function arrive() {
    arrived += 1;
    if (arrived >= parties) release();
    await opened;
  };
}

test('DIN-427 un mensaje nuevo se procesa una vez y el retry no lo repite', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('NEW');
  t.after(() => deleteEvent(messageId));
  let turns = 0;
  const first = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, phone()),
    processInbound: async () => {
      turns += 1;
      return replyTurn('Menú único');
    },
  });
  const second = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, phone(), 'otro texto'),
    processInbound: async () => {
      turns += 1;
      return replyTurn('No debe correr');
    },
  });
  assert.equal(first.httpStatus, 200);
  assert.match(first.twiml, /Menú único/);
  assert.equal(second.httpStatus, 200);
  assert.equal(second.twiml, first.twiml);
  assert.equal(turns, 1);
  const row = await eventRow(messageId);
  assert.equal(row.status, 'PROCESSED');
  assert.equal(Number(row.attempts), 1);
  assert.match(row.response_body, /Menú único/);
});

test('DIN-427 ocho adquisiciones del mismo MessageSid dejan un solo dueño', { timeout: 20000 }, async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const parties = 8;
  const messageId = sid('N');
  const from = phone();
  const body = inboundBody(messageId, from, 'ocho');
  t.after(() => deleteEvent(messageId));
  const arrive = openBarrier(parties);
  const allBegan = deferred();
  const ownerEntered = deferred();
  const releaseOwner = deferred();
  let began = 0;
  let turns = 0;
  const pending = Promise.all(Array.from({ length: parties }, () => settleTwilioInbound({
    flowId: 'main-menu',
    body,
    begin: async (input) => {
      await arrive();
      const gate = await beginInboundEvent(input);
      began += 1;
      if (began === parties) allBegan.resolve();
      return gate;
    },
    processInbound: async () => {
      turns += 1;
      ownerEntered.resolve();
      await allBegan.promise;
      await releaseOwner.promise;
      return replyTurn('unico');
    },
  })));
  await ownerEntered.promise;
  await allBegan.promise;
  assert.equal(began, parties);
  assert.equal(turns, 1);
  const during = await eventRow(messageId);
  assert.equal(during.status, 'PROCESSING');
  assert.equal(Number(during.attempts), 1);
  releaseOwner.resolve();
  const firstWave = await pending;
  const accepted = firstWave.filter((item) => item.httpStatus === 200);
  const blocked = firstWave.filter((item) => item.httpStatus === 503);
  assert.equal(accepted.length, 1);
  assert.equal(blocked.length, parties - 1);
  assert.match(accepted[0].twiml, /unico/);
  assert.equal(blocked.some((item) => item.twiml.includes('unico')), false);
  const row = await eventRow(messageId);
  assert.equal(row.status, 'PROCESSED');
  assert.equal(Number(row.attempts), 1);
  assert.equal(row.response_body, accepted[0].twiml);
  const { rows } = await query(
    'SELECT COUNT(*) AS total FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
    [messageId],
  );
  assert.equal(Number(rows[0].total), 1);

  const retries = await Promise.all([0, 1, 2].map(() => settleTwilioInbound({
    flowId: 'main-menu',
    body,
    processInbound: async () => {
      turns += 1;
      return replyTurn('intruso');
    },
  })));
  assert.equal(turns, 1);
  for (const retry of retries) {
    assert.equal(retry.httpStatus, 200);
    assert.equal(retry.twiml, accepted[0].twiml);
  }
  assert.equal(Number((await eventRow(messageId)).attempts), 1);
});

test('DIN-427 un lease vencido no deja completar ni duplicar al primer trabajador', { timeout: 20000 }, async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('LEASE');
  const from = phone();
  const userId = `twilio:whatsapp:${from}`;
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: userId,
    phoneNumber: from,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
  t.after(async () => {
    await sessionService.resetSession(userId);
    await deleteEvent(messageId);
    await deleteConversation(created.id);
  });

  const owned = deferred();
  const secondInside = deferred();
  const releaseSecond = deferred();
  const releaseFirst = deferred();
  let staleAttempts = null;

  const first = settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from, 'hola'),
    processInbound: async (event, { lease }) => withInboundLease(lease, async () => {
      await conversationMessageRepository.createMessage({
        conversationId: created.id,
        direction: 'inbound',
        senderType: 'user',
        body: 'antes del vencimiento',
        provider: 'twilio',
        providerMessageId: messageId,
      });
      await sessionService.createSession(event.userId, 'main-menu', 'nodo-viejo');
      owned.resolve(lease);
      await releaseFirst.promise;
      await conversationMessageRepository.createMessage({
        conversationId: created.id,
        direction: 'outbound',
        senderType: 'bot',
        body: 'no debe quedar',
        provider: 'twilio',
        providerMessageId: `late-${messageId}`.slice(0, 128),
      });
      return replyTurn('respuesta vieja');
    }),
  });

  const firstLease = await owned.promise;
  await query(
    `UPDATE dbo.provider_webhook_events
     SET updated_at = DATEADD(minute, -10, SYSUTCDATETIME())
     WHERE id = $1 AND attempts = $2`,
    [firstLease.id, firstLease.attempts],
  );

  const second = settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from, 'hola'),
    processInbound: async (_event, { lease }) => withInboundLease(lease, async () => {
      staleAttempts = lease.attempts;
      secondInside.resolve();
      await releaseSecond.promise;
      await conversationMessageRepository.createMessage({
        conversationId: created.id,
        direction: 'outbound',
        senderType: 'bot',
        body: 'respuesta nueva',
        provider: 'twilio',
        providerMessageId: twilioTurnOutboundId(messageId),
      });
      return replyTurn('respuesta nueva');
    }),
  });

  await secondInside.promise;
  assert.equal(staleAttempts, 2);
  const whileReclaimed = await eventRow(messageId);
  assert.equal(whileReclaimed.status, 'PROCESSING');
  assert.equal(Number(whileReclaimed.attempts), 2);

  await assert.rejects(
    () => processCanonicalTwilioInbound(
      {
        provider: 'twilio',
        flowId: 'main-menu',
        userId,
        phone: from,
        text: 'hola',
        messageId,
        rawPayload: inboundBody(messageId, from, 'hola'),
      },
      { lease: { id: firstLease.id, attempts: firstLease.attempts } },
    ),
    (error) => error?.code === 'INBOUND_LEASE_LOST',
  );
  assert.equal(sessionService.getSession(userId), null);
  const parked = await conversationRepository.findById(created.id);
  assert.equal(parked.currentNodeKey, 'welcome');
  assert.equal(parked.status, 'bot');
  assert.equal((await messageCounts(created.id)).inbound, 1);
  assert.equal((await messageCounts(created.id)).outbound, 0);

  releaseSecond.resolve();
  const secondResult = await second;
  releaseFirst.resolve();
  const firstResult = await first;

  assert.equal(secondResult.httpStatus, 200);
  assert.match(secondResult.twiml, /respuesta nueva/);
  assert.equal(firstResult.httpStatus, 503);
  assert.doesNotMatch(firstResult.twiml, /respuesta vieja/);
  assert.doesNotMatch(firstResult.twiml, /respuesta nueva/);

  const stored = await eventRow(messageId);
  assert.equal(stored.status, 'PROCESSED');
  assert.equal(Number(stored.attempts), 2);
  assert.match(stored.response_body, /respuesta nueva/);
  assert.doesNotMatch(stored.response_body, /respuesta vieja/);
  const bodies = await query(
    `SELECT direction, body FROM dbo.conversation_messages WHERE conversation_id = $1`,
    [created.id],
  );
  assert.equal(bodies.rows.filter((row) => row.direction === 'inbound').length, 1);
  assert.equal(bodies.rows.filter((row) => row.direction === 'outbound').length, 1);
  assert.equal(bodies.rows.some((row) => String(row.body).includes('no debe quedar')), false);

  const retry = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from, 'hola'),
    processInbound: processCanonicalTwilioInbound,
  });
  assert.equal(retry.httpStatus, 200);
  assert.equal(retry.twiml, secondResult.twiml);
  assert.equal((await messageCounts(created.id)).outbound, 1);
  assert.equal((await conversationRepository.findById(created.id)).currentNodeKey, 'welcome');
});

test('DIN-427 la idempotencia no cambia con MONITORING_ENABLED', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const previous = config.monitoringEnabled;
  const ids = [];
  t.after(async () => {
    config.monitoringEnabled = previous;
    for (const messageId of ids) await deleteEvent(messageId);
  });
  for (const enabled of [false, true]) {
    config.monitoringEnabled = enabled;
    const messageId = sid(enabled ? 'ON' : 'OFF');
    ids.push(messageId);
    let turns = 0;
    const processInbound = async () => {
      turns += 1;
      return replyTurn('igual');
    };
    const first = await settleTwilioInbound({
      flowId: 'main-menu',
      body: inboundBody(messageId, phone()),
      processInbound,
    });
    const second = await settleTwilioInbound({
      flowId: 'main-menu',
      body: inboundBody(messageId, phone()),
      processInbound,
    });
    assert.equal(first.httpStatus, 200);
    assert.equal(second.httpStatus, 200);
    assert.equal(second.twiml, first.twiml);
    assert.equal(turns, 1);
    const row = await eventRow(messageId);
    assert.equal(row.status, 'PROCESSED');
    assert.equal(Number(row.attempts), 1);
  }
});

test('DIN-427 un error de SQL no procesa el turno', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('SQL');
  t.after(() => deleteEvent(messageId));
  let turns = 0;
  const result = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, phone()),
    begin: async () => {
      await query('SELECT * FROM dbo.din427_relation_missing');
    },
    processInbound: async () => {
      turns += 1;
      return replyTurn('no');
    },
  });
  assert.equal(result.httpStatus, 503);
  assert.match(result.twiml, /<Response><\/Response>/);
  assert.equal(turns, 0);
  assert.equal(await eventRow(messageId), null);
});

test('DIN-427 un error antes de completar queda reintentable y no PROCESSED', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('FAIL');
  t.after(() => deleteEvent(messageId));
  let turns = 0;
  const failed = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, phone()),
    processInbound: async () => {
      turns += 1;
      throw new Error('turno incompleto');
    },
  });
  assert.equal(failed.httpStatus, 503);
  assert.match(failed.twiml, /<Response><\/Response>/);
  let row = await eventRow(messageId);
  assert.equal(row.status, 'FAILED');
  assert.equal(row.response_body, null);
  const recovered = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, phone()),
    processInbound: async () => {
      turns += 1;
      return replyTurn('recuperado');
    },
  });
  assert.equal(recovered.httpStatus, 200);
  assert.match(recovered.twiml, /recuperado/);
  assert.equal(turns, 2);
  row = await eventRow(messageId);
  assert.equal(row.status, 'PROCESSED');
  assert.equal(Number(row.attempts), 2);
});

test('DIN-427 un efecto ya guardado no se duplica si el cierre falla', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('EFFECT');
  const from = phone();
  const conversation = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `twilio:whatsapp:${from}`,
    phoneNumber: from,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
  t.after(async () => {
    await deleteEvent(messageId);
    await deleteConversation(conversation.id);
  });
  const outboundId = twilioTurnOutboundId(messageId);
  let finishes = 0;
  const processInbound = async (event) => {
    const replay = await messagePersistence.replayCommittedTurn(event);
    if (replay) return replay;
    await conversationMessageRepository.createMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      senderType: 'bot',
      body: 'respuesta unica',
      provider: 'twilio',
      providerMessageId: outboundId,
      metadataJson: { event: 'bot_reply' },
    });
    return replyTurn('respuesta unica');
  };
  const finish = async (gate, error, responseBody) => {
    finishes += 1;
    if (!error && finishes === 1) throw new Error('cierre perdido');
    return finishInboundEvent(gate, error, undefined, responseBody);
  };
  const lost = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from),
    processInbound,
    finish,
  });
  assert.equal(lost.httpStatus, 503);
  assert.doesNotMatch(lost.twiml, /respuesta unica/);
  assert.equal((await eventRow(messageId)).status, 'FAILED');
  assert.equal((await messageCounts(conversation.id)).outbound, 1);
  const retried = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from),
    processInbound,
    finish,
  });
  const again = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from),
    processInbound,
    finish,
  });
  assert.equal(retried.httpStatus, 200);
  assert.match(retried.twiml, /respuesta unica/);
  assert.equal(again.httpStatus, 200);
  assert.equal(again.twiml, retried.twiml);
  assert.equal((await messageCounts(conversation.id)).outbound, 1);
  assert.equal((await eventRow(messageId)).status, 'PROCESSED');
});

test('DIN-427 dos MessageSid distintos pueden procesarse a la vez', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const leftId = sid('A');
  const rightId = sid('B');
  t.after(async () => {
    await deleteEvent(leftId);
    await deleteEvent(rightId);
  });
  const [left, right] = await Promise.all([
    settleTwilioInbound({
      flowId: 'main-menu',
      body: inboundBody(leftId, phone(), 'primero'),
      processInbound: async () => replyTurn('primero'),
    }),
    settleTwilioInbound({
      flowId: 'main-menu',
      body: inboundBody(rightId, phone(), 'segundo'),
      processInbound: async () => replyTurn('segundo'),
    }),
  ]);
  assert.equal(left.httpStatus, 200);
  assert.equal(right.httpStatus, 200);
  assert.match(left.twiml, /primero/);
  assert.match(right.twiml, /segundo/);
  assert.equal((await eventRow(leftId)).status, 'PROCESSED');
  assert.equal((await eventRow(rightId)).status, 'PROCESSED');
});

test('DIN-427 un reloj de aplicación adelantado no roba un PROCESSING vigente', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('CLOCK');
  t.after(() => deleteEvent(messageId));
  await query(
    `INSERT INTO dbo.provider_webhook_events (
      provider, event_type, provider_message_id, status, attempts, updated_at
    ) VALUES (N'twilio', N'inbound', $1, N'PROCESSING', 1, SYSUTCDATETIME())`,
    [messageId],
  );
  const result = await acquireInboundProcessing({
    provider: 'twilio',
    eventType: 'inbound',
    providerMessageId: messageId,
    payloadJson: null,
    maxAttempts: 3,
    staleBefore: new Date(Date.now() + 60 * 60 * 1000),
    staleSeconds: 120,
  });
  assert.equal(result.acquired, false);
  assert.equal(result.reason, 'in_flight');
  const row = await eventRow(messageId);
  assert.equal(row.status, 'PROCESSING');
  assert.equal(Number(row.attempts), 1);
});

test('DIN-427 el índice único rechaza dos filas del mismo MessageSid', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('UQ');
  t.after(() => deleteEvent(messageId));
  const insert = `INSERT INTO dbo.provider_webhook_events (
    provider, event_type, provider_message_id, status, attempts
  ) VALUES (N'twilio', N'inbound', $1, N'PROCESSING', 1)`;
  const settled = await Promise.allSettled([
    query(insert, [messageId]),
    query(insert, [messageId]),
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.filter((item) => item.status === 'rejected');
  assert.equal(rejected.length, 1);
  const number = rejected[0].reason?.number || rejected[0].reason?.originalError?.info?.number;
  assert.ok(number === 2601 || number === 2627);
  const { rows } = await query(
    'SELECT COUNT(*) AS total FROM dbo.provider_webhook_events WHERE provider_message_id = $1',
    [messageId],
  );
  assert.equal(Number(rows[0].total), 1);
});

test('DIN-427 una conversación tomada no cambia de estado ni se responde dos veces', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const messageId = sid('HUMAN');
  const from = phone();
  const agentId = randomUUID();
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `twilio:whatsapp:${from}`,
    phoneNumber: from,
    displayName: 'tomada',
    status: 'assigned',
    currentFlowId: 'main-menu',
    currentNodeKey: 'human_handoff',
  });
  t.after(async () => {
    await deleteEvent(messageId);
    await deleteConversation(created.id);
  });
  const conversation = await conversationRepository.updateConversation(created.id, {
    assignedAgentId: agentId,
  });
  const first = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from, 'hola, estoy con una persona'),
    processInbound: processCanonicalTwilioInbound,
  });
  const afterFirst = await conversationRepository.findById(conversation.id);
  const second = await settleTwilioInbound({
    flowId: 'main-menu',
    body: inboundBody(messageId, from, 'hola, estoy con una persona'),
    processInbound: processCanonicalTwilioInbound,
  });
  const afterSecond = await conversationRepository.findById(conversation.id);
  assert.equal(first.httpStatus, 200);
  assert.match(first.twiml, /<Response><\/Response>/);
  assert.equal(second.httpStatus, 200);
  assert.equal(second.twiml, first.twiml);
  assert.equal(afterFirst.status, 'assigned');
  assert.equal(afterFirst.currentNodeKey, 'human_handoff');
  assert.equal(afterFirst.assignedAgentId, agentId);
  assert.equal(afterSecond.status, 'assigned');
  assert.equal(afterSecond.currentNodeKey, 'human_handoff');
  assert.equal(afterSecond.assignedAgentId, agentId);
  assert.equal(afterSecond.reentryJson, null);
  const counts = await messageCounts(conversation.id);
  assert.equal(counts.inbound, 1);
  assert.equal(counts.outbound, 0);
  assert.equal((await eventRow(messageId)).status, 'PROCESSED');
});

test('DIN-427 una reentrada pendiente no se consume dos veces con el mismo MessageSid', async (t) => {
  const reason = await dbUnavailable();
  if (reason) {
    t.skip(reason);
    return;
  }
  const previousPolicy = process.env.REENTRY_POLICY;
  process.env.REENTRY_POLICY = 'prompt';
  const messageId = sid('REENTRY');
  const from = phone();
  const created = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `twilio:whatsapp:${from}`,
    phoneNumber: from,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v11',
    currentNodeKey: null,
  });
  const pending = {
    v: 1,
    status: 'pending',
    flowId: 'main-menu',
    flowVersion: 'v11',
    resumeNodeKey: 'welcome',
    variables: {},
    history: ['welcome'],
    tracking: { answers: {}, visitedNodes: ['welcome'], transitionTrail: [] },
    capturedAt: new Date().toISOString(),
  };
  await conversationRepository.updateConversation(created.id, { reentryJson: pending });
  t.after(async () => {
    if (previousPolicy === undefined) delete process.env.REENTRY_POLICY;
    else process.env.REENTRY_POLICY = previousPolicy;
    await deleteEvent(messageId);
    await deleteConversation(created.id);
  });
  const body = inboundBody(messageId, from, 'sigo con la consulta anterior');
  const first = await settleTwilioInbound({
    flowId: 'main-menu',
    body,
    processInbound: processCanonicalTwilioInbound,
  });
  const afterFirst = await conversationRepository.findById(created.id);
  const second = await settleTwilioInbound({
    flowId: 'main-menu',
    body,
    processInbound: processCanonicalTwilioInbound,
  });
  const afterSecond = await conversationRepository.findById(created.id);
  assert.equal(first.httpStatus, 200, first.twiml);
  assert.match(first.twiml, /consulta anterior/);
  assert.equal(second.httpStatus, 200);
  assert.equal(second.twiml, first.twiml);
  assert.equal(afterFirst.reentryJson.status, 'awaiting_choice');
  assert.equal(afterFirst.reentryJson.invalidAttempts, 0);
  assert.equal(afterFirst.currentNodeKey, null);
  assert.deepEqual(afterSecond.reentryJson, afterFirst.reentryJson);
  assert.equal(afterSecond.currentNodeKey, afterFirst.currentNodeKey);
  assert.equal(afterSecond.status, afterFirst.status);
  const counts = await messageCounts(created.id);
  assert.equal(counts.inbound, 1);
  assert.equal(counts.outbound, 1);
  assert.equal((await eventRow(messageId)).status, 'PROCESSED');
});
