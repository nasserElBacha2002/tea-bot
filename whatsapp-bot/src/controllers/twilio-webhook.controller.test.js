import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { config } from '../config.js';
import { settleTwilioInbound } from './twilio-webhook.controller.js';
import { beginInboundEvent, finishInboundEvent } from '../monitoring/webhook-events.service.js';
import { buildTwimlMessage } from '../adapters/twilio/twilio-outbound.adapter.js';

function createRepo() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    async acquireInboundProcessing(input) {
      const now = new Date().toISOString();
      const match = [...rows.values()].find((row) => (
        row.provider === input.provider
        && row.eventType === input.eventType
        && row.providerMessageId === input.providerMessageId
      ));
      if (!match) {
        seq += 1;
        const stored = {
          id: `id-${seq}`,
          provider: input.provider,
          eventType: input.eventType,
          providerMessageId: input.providerMessageId,
          status: 'PROCESSING',
          attempts: 1,
          updatedAt: now,
          responseBody: null,
        };
        rows.set(stored.id, stored);
        return { acquired: true, row: { ...stored }, reason: 'acquired' };
      }
      const stale = match.status === 'PROCESSING'
        && new Date(match.updatedAt).getTime() < new Date(input.staleBefore).getTime();
      const canFail = match.status === 'FAILED' && match.attempts < input.maxAttempts;
      const canStale = stale && match.attempts < input.maxAttempts;
      if (canFail || canStale) {
        match.attempts += 1;
        match.status = 'PROCESSING';
        match.updatedAt = now;
        return {
          acquired: true,
          row: { ...match },
          reason: canStale ? 'reclaimed' : 'retry',
        };
      }
      let reason = 'in_flight';
      if (match.status === 'PROCESSED') reason = 'processed';
      else if (match.status === 'DEAD_LETTER') reason = 'dead_letter';
      return { acquired: false, row: { ...match }, reason };
    },
    async markWebhookProcessed(id, options = {}) {
      const row = rows.get(id);
      if (!row || row.status !== 'PROCESSING') return { owned: false, replayStored: false };
      if (Number(row.attempts) !== Number(options.attempts)) return { owned: false, replayStored: false };
      row.status = 'PROCESSED';
      row.responseBody = options.responseBody ?? null;
      return { owned: true, replayStored: true };
    },
    async markWebhookFailed(id, patch) {
      const row = rows.get(id);
      if (!row || row.status !== 'PROCESSING') return { owned: false };
      if (Number(row.attempts) !== Number(patch.attempts)) return { owned: false };
      row.status = patch.status;
      row.errorMessage = patch.errorMessage;
      return { owned: true };
    },
  };
}

function harness(repo, processInbound) {
  return {
    begin: (input) => beginInboundEvent(input, repo),
    finish: (gate, error, responseBody) => finishInboundEvent(gate, error, repo, responseBody),
    processInbound,
  };
}

function body(messageId, text = 'hola') {
  return {
    MessageSid: messageId,
    Body: text,
    From: 'whatsapp:+5491100001111',
    NumMedia: '0',
  };
}

test('T07 el mismo MessageSid tiene un solo turno y el retry reproduce el TwiML', async () => {
  const repo = createRepo();
  let turns = 0;
  const deps = harness(repo, async () => {
    turns += 1;
    return { kind: 'bot', reply: 'Menú principal', replyAuthorized: true };
  });
  const first = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM100'),
    ...deps,
  });
  const second = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM100', 'otro texto'),
    ...deps,
  });
  assert.equal(first.httpStatus, 200);
  assert.equal(second.httpStatus, 200);
  assert.equal(turns, 1);
  assert.equal(second.twiml, first.twiml);
  assert.equal(second.twiml, buildTwimlMessage('Menú principal'));
  assert.equal(repo.rows.size, 1);
  assert.equal([...repo.rows.values()][0].status, 'PROCESSED');
});

test('T08 un fallo no queda PROCESSED y el reintento puede completar', async () => {
  const repo = createRepo();
  let turns = 0;
  const deps = harness(repo, async () => {
    turns += 1;
    if (turns === 1) throw new Error('db down');
    return { kind: 'bot', reply: 'recuperado', replyAuthorized: true };
  });
  const failed = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-FAIL'),
    ...deps,
  });
  assert.equal(failed.httpStatus, 503);
  assert.equal([...repo.rows.values()][0].status, 'FAILED');
  const recovered = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-FAIL'),
    ...deps,
  });
  assert.equal(recovered.httpStatus, 200);
  assert.match(recovered.twiml, /recuperado/);
  assert.equal([...repo.rows.values()][0].status, 'PROCESSED');
  assert.equal(turns, 2);
});

test('T09 la idempotencia no depende de MONITORING_ENABLED', async () => {
  const previous = config.monitoringEnabled;
  try {
    for (const enabled of [false, true]) {
      config.monitoringEnabled = enabled;
      const repo = createRepo();
      let turns = 0;
      const deps = harness(repo, async () => {
        turns += 1;
        return { kind: 'bot', reply: 'uno', replyAuthorized: true };
      });
      await settleTwilioInbound({ flowId: 'main-menu', body: body(`SM-FLAG-${enabled}`), ...deps });
      await settleTwilioInbound({ flowId: 'main-menu', body: body(`SM-FLAG-${enabled}`), ...deps });
      assert.equal(turns, 1);
      assert.equal([...repo.rows.values()][0].status, 'PROCESSED');
    }
  } finally {
    config.monitoringEnabled = previous;
  }
});

test('T11 el dueño anterior no pisa el TwiML del worker que reclamó', async () => {
  const repo = createRepo();
  const deps = harness(repo, async () => ({ kind: 'bot', reply: 'nuevo', replyAuthorized: true }));
  const firstGate = await beginInboundEvent({
    event: { provider: 'twilio', messageId: 'SM-LEASE', flowId: 'main-menu' },
    payload: body('SM-LEASE'),
  }, repo);
  repo.rows.get(firstGate.id).updatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const settled = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-LEASE'),
    ...deps,
  });
  assert.equal(settled.httpStatus, 200);
  const late = await finishInboundEvent(firstGate, null, repo, buildTwimlMessage('viejo'));
  assert.equal(late.owned, false);
  assert.match([...repo.rows.values()][0].responseBody, /nuevo/);
  assert.doesNotMatch([...repo.rows.values()][0].responseBody, /viejo/);
});

test('T12 si SQL no adquiere, no hay turno ni archivo de dedupe', async () => {
  let turns = 0;
  const result = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-DOWN'),
    begin: async () => {
      throw new Error('pool unavailable');
    },
    processInbound: async () => {
      turns += 1;
      return { kind: 'bot', reply: 'no', replyAuthorized: true };
    },
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(turns, 0);
  assert.match(result.twiml, /<Response><\/Response>/);
});

test('T13 el retry después de un HTTP perdido reproduce el TwiML sin otro turno', async () => {
  const repo = createRepo();
  let turns = 0;
  const deps = harness(repo, async () => {
    turns += 1;
    return { kind: 'reentry', reply: '¿Seguimos con esta consulta?', replyAuthorized: true };
  });
  const first = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-REPLAY', 'texto libre'),
    ...deps,
  });
  const retry = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-REPLAY', 'texto libre'),
    ...deps,
  });
  assert.equal(first.httpStatus, 200);
  assert.equal(retry.httpStatus, 200);
  assert.equal(retry.twiml, first.twiml);
  assert.match(retry.twiml, /Seguimos/);
  assert.equal(turns, 1);
});

test('T14 un retry del primer mensaje de reentrada no vuelve a consumir la elección', async () => {
  const repo = createRepo();
  let consumes = 0;
  let status = 'pending';
  const deps = harness(repo, async () => {
    consumes += 1;
    status = 'awaiting_choice';
    return { kind: 'reentry', reply: 'prompt de reentrada', replyAuthorized: true };
  });
  await settleTwilioInbound({ flowId: 'main-menu', body: body('SM-REENTRY', 'quiero seguir'), ...deps });
  await settleTwilioInbound({ flowId: 'main-menu', body: body('SM-REENTRY', 'quiero seguir'), ...deps });
  assert.equal(consumes, 1);
  assert.equal(status, 'awaiting_choice');
});

test('T15 una toma que suprime el turno no se reactiva en el retry', async () => {
  const repo = createRepo();
  let turns = 0;
  const deps = harness(repo, async () => {
    turns += 1;
    return { kind: 'human_mode_skip', reply: null, replyAuthorized: false, conversation: { status: 'assigned' } };
  });
  const first = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-TAKE'),
    ...deps,
  });
  const second = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-TAKE'),
    ...deps,
  });
  assert.equal(first.httpStatus, 200);
  assert.match(first.twiml, /<Response><\/Response>/);
  assert.equal(second.httpStatus, 200);
  assert.equal(second.twiml, first.twiml);
  assert.equal(turns, 1);
});

test('un PROCESSING vigente no confirma el webhook con 200', async () => {
  const repo = createRepo();
  await beginInboundEvent({
    event: { provider: 'twilio', messageId: 'SM-BUSY', flowId: 'main-menu' },
    payload: body('SM-BUSY'),
  }, repo);
  let turns = 0;
  const result = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-BUSY'),
    ...harness(repo, async () => {
      turns += 1;
      return { kind: 'bot', reply: 'tarde', replyAuthorized: true };
    }),
  });
  assert.equal(result.httpStatus, 503);
  assert.equal(turns, 0);
  assert.equal([...repo.rows.values()][0].status, 'PROCESSING');
});

test('un MessageSid ausente no se procesa ni se inventa', async () => {
  let turns = 0;
  let began = 0;
  const result = await settleTwilioInbound({
    flowId: 'main-menu',
    body: { Body: 'hola', From: 'whatsapp:+5491100001111' },
    begin: async (input) => {
      began += 1;
      return beginInboundEvent(input, createRepo());
    },
    processInbound: async () => {
      turns += 1;
      return { kind: 'bot', reply: 'no', replyAuthorized: true };
    },
  });
  assert.equal(began, 1);
  assert.equal(result.httpStatus, 400);
  assert.equal(turns, 0);
});

test('un handoff humano vacío no genera un mensaje de WhatsApp', async () => {
  const repo = createRepo();
  const result = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-HAND'),
    ...harness(repo, async () => ({
      kind: 'human_handoff',
      reply: 'Te derivamos',
      shouldSendTwiml: false,
      replyAuthorized: false,
    })),
  });
  assert.equal(result.httpStatus, 200);
  assert.match(result.twiml, /<Response><\/Response>/);
  assert.doesNotMatch(result.twiml, /derivamos/);
});

test('TAKEOVER_SCHEMA_REQUIRED no queda PROCESSED ni confirma el webhook', async () => {
  const repo = createRepo();
  const thrown = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-SCHEMA'),
    ...harness(repo, async () => {
      const error = new Error('schema');
      error.code = 'TAKEOVER_SCHEMA_REQUIRED';
      throw error;
    }),
  });
  const indeterminate = await settleTwilioInbound({
    flowId: 'main-menu',
    body: body('SM-SCHEMA-2'),
    ...harness(repo, async () => ({
      kind: 'reply_indeterminate',
      reason: 'takeover_schema_required',
      reply: 'no enviar',
      replyAuthorized: false,
    })),
  });
  assert.equal(thrown.httpStatus, 503);
  assert.equal(indeterminate.httpStatus, 503);
  assert.match(thrown.twiml, /<Response><\/Response>/);
  assert.doesNotMatch(indeterminate.twiml, /no enviar/);
  const statuses = [...repo.rows.values()].map((row) => row.status);
  assert.deepEqual(statuses, ['FAILED', 'FAILED']);
});

test('el controlador no usa el dedupe local ni el flag de monitoreo', () => {
  const source = fs.readFileSync(new URL('./twilio-webhook.controller.js', import.meta.url), 'utf8');
  assert.equal(source.includes('webhookDedupe'), false);
  assert.equal(source.includes('monitoringEnabled'), false);
  assert.equal(source.includes('Twilio From'), false);
  assert.equal(source.includes('Normalized phone'), false);
});

test('el cierre SQL solo lo puede hacer el attempts dueño', () => {
  const source = fs.readFileSync(
    new URL('../monitoring/monitoring.repository.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /AND status = N'PROCESSING'\s+AND attempts = \$2/);
  assert.match(source, /AND status = N'PROCESSING'\s+AND attempts = \$5/);
  assert.match(source, /DELETED\.status AS previous_status/);
  assert.match(source, /DATEADD\(second, -1 \* \$5, SYSUTCDATETIME\(\)\)/);
  assert.equal(source.includes('updated_at < $5'), false);
});

test('la migracion 010 solo agrega response_body', () => {
  const sql = fs.readFileSync(
    new URL('../../migrations/010_webhook_response_body.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /response_body NVARCHAR\(MAX\) NULL/);
  assert.equal(sql.includes('DROP '), false);
  assert.equal(sql.includes('007_monitoring'), false);
});
