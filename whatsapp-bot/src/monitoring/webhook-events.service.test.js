import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beginInboundEvent, finishInboundEvent } from './webhook-events.service.js';

function createRepo() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    async insertWebhookEvent(row) {
      seq += 1;
      const stored = { ...row, id: `id-${seq}`, updatedAt: new Date().toISOString() };
      rows.set(stored.id, stored);
      return { inserted: true, row: stored };
    },
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
          payloadJson: input.payloadJson,
        };
        rows.set(stored.id, stored);
        return { acquired: true, row: { ...stored }, reason: 'acquired' };
      }
      const stale = match.status === 'PROCESSING'
        && new Date(match.updatedAt).getTime() < new Date(input.staleBefore).getTime();
      const canReceive = match.status === 'RECEIVED' && match.attempts <= input.maxAttempts;
      const canFail = match.status === 'FAILED' && match.attempts < input.maxAttempts;
      const canStale = stale && match.attempts < input.maxAttempts;
      if (canReceive || canFail || canStale) {
        const reason = canStale ? 'reclaimed' : (canFail ? 'retry' : 'acquired');
        if (!canReceive) match.attempts += 1;
        match.status = 'PROCESSING';
        match.updatedAt = now;
        return { acquired: true, row: { ...match }, reason };
      }
      const exhausted = match.attempts >= input.maxAttempts && (
        match.status === 'FAILED' || match.status === 'RECEIVED' || stale
      );
      if (exhausted) {
        match.status = 'DEAD_LETTER';
        match.updatedAt = now;
        match.errorMessage = match.errorMessage || 'max_attempts';
        return { acquired: false, row: { ...match }, reason: 'dead_letter' };
      }
      let reason = 'in_flight';
      if (match.status === 'PROCESSED') reason = 'processed';
      else if (match.status === 'DEAD_LETTER') reason = 'dead_letter';
      return { acquired: false, row: { ...match }, reason };
    },
    async markWebhookProcessed(id, options = {}) {
      const row = rows.get(id);
      if (!row || row.status !== 'PROCESSING') return { owned: false, replayStored: false };
      if (options.attempts != null && Number(row.attempts) !== Number(options.attempts)) {
        return { owned: false, replayStored: false };
      }
      row.status = 'PROCESSED';
      row.responseBody = options.responseBody ?? null;
      row.processedAt = new Date().toISOString();
      row.updatedAt = row.processedAt;
      return { owned: true, replayStored: true };
    },
    async markWebhookFailed(id, patch) {
      const row = rows.get(id);
      if (!row || row.status !== 'PROCESSING') return { owned: false };
      if (patch.attempts != null && Number(row.attempts) !== Number(patch.attempts)) {
        return { owned: false };
      }
      row.status = patch.status;
      row.errorCode = patch.errorCode;
      row.errorMessage = patch.errorMessage;
      row.updatedAt = new Date().toISOString();
      return { owned: true };
    },
  };
}

const event = { provider: 'twilio', messageId: 'SM100' };

test('webhook nuevo queda en procesamiento y luego PROCESSED', async () => {
  const repo = createRepo();
  const gate = await beginInboundEvent({ event, payload: { MessageSid: 'SM100', Body: 'hola' } }, repo);
  assert.equal(gate.action, 'process');
  assert.equal(gate.attempts, 1);
  await finishInboundEvent(gate, null, repo);
  assert.equal(repo.rows.get(gate.id).status, 'PROCESSED');
});

test('provider_message_id duplicado ya procesado no se vuelve a procesar', async () => {
  const repo = createRepo();
  const first = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  await finishInboundEvent(first, null, repo);
  const second = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(second.action, 'skip');
  assert.equal(second.reason, 'processed');
  assert.equal(repo.rows.size, 1);
});

test('PROCESSING reciente no se vuelve a procesar', async () => {
  const repo = createRepo();
  const first = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  const second = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(first.action, 'process');
  assert.equal(second.action, 'skip');
  assert.equal(second.reason, 'in_flight');
  assert.equal(repo.rows.get(first.id).status, 'PROCESSING');
  assert.equal(repo.rows.get(first.id).attempts, 1);
});

test('PROCESSING stale se puede reclamar e incrementa attempts', async () => {
  const repo = createRepo();
  const first = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  repo.rows.get(first.id).updatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const second = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(second.action, 'process');
  assert.equal(second.attempts, 2);
  assert.equal(repo.rows.size, 1);
});

test('fallo de procesamiento marca FAILED y el tercer intento queda DEAD_LETTER', async () => {
  const repo = createRepo();
  const first = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  await finishInboundEvent(first, new Error('db down'), repo);
  assert.equal(repo.rows.get(first.id).status, 'FAILED');

  const second = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(second.action, 'process');
  assert.equal(second.attempts, 2);
  await finishInboundEvent(second, new Error('db down'), repo);

  const third = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(third.attempts, 3);
  await finishInboundEvent(third, new Error('db down'), repo);
  assert.equal(repo.rows.get(first.id).status, 'DEAD_LETTER');

  const fourth = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(fourth.action, 'skip');
  assert.equal(fourth.reason, 'dead_letter');
});

test('el worker anterior no cierra un evento ya reclamado', async () => {
  const repo = createRepo();
  const first = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  repo.rows.get(first.id).updatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const second = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(second.reason, 'reclaimed');
  assert.equal(second.attempts, 2);
  const staleFinish = await finishInboundEvent(first, null, repo, '<Response>viejo</Response>');
  assert.equal(staleFinish.owned, false);
  assert.equal(repo.rows.get(first.id).status, 'PROCESSING');
  const ownedFinish = await finishInboundEvent(second, null, repo, '<Response>nuevo</Response>');
  assert.equal(ownedFinish.owned, true);
  assert.equal(repo.rows.get(first.id).status, 'PROCESSED');
  assert.equal(repo.rows.get(first.id).responseBody, '<Response>nuevo</Response>');
  const replay = await beginInboundEvent({ event, payload: { MessageSid: 'SM100', Body: 'otro' } }, repo);
  assert.equal(replay.action, 'skip');
  assert.equal(replay.reason, 'processed');
  assert.equal(replay.responseBody, '<Response>nuevo</Response>');
});

test('la adquisicion no consulta el flag y mide el lease en segundos de SQL', () => {
  const source = fs.readFileSync(new URL('./webhook-events.service.js', import.meta.url), 'utf8');
  assert.equal(source.includes('monitoringEnabled'), false);
  assert.match(source, /staleSeconds: staleWindowSeconds\(\)/);
});

test('FAILED en el maximo de intentos queda DEAD_LETTER y no procesa', async () => {
  const repo = createRepo();
  repo.rows.set('id-x', {
    id: 'id-x',
    provider: 'twilio',
    eventType: 'inbound',
    providerMessageId: 'SM100',
    status: 'FAILED',
    attempts: 3,
    updatedAt: new Date().toISOString(),
  });
  const gate = await beginInboundEvent({ event, payload: { MessageSid: 'SM100' } }, repo);
  assert.equal(gate.action, 'skip');
  assert.equal(gate.reason, 'dead_letter');
  assert.equal(repo.rows.get('id-x').status, 'DEAD_LETTER');
});
