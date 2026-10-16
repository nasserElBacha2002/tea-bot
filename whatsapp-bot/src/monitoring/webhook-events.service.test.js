import test from 'node:test';
import assert from 'node:assert/strict';
import { beginInboundEvent, finishInboundEvent } from './webhook-events.service.js';

function createRepo() {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    async findWebhookEvent(provider, eventType, providerMessageId) {
      return [...rows.values()].find((row) => (
        row.provider === provider
        && row.eventType === eventType
        && row.providerMessageId === providerMessageId
      )) || null;
    },
    async insertWebhookEvent(row) {
      const duplicate = [...rows.values()].find((item) => (
        item.provider === row.provider
        && item.eventType === row.eventType
        && item.providerMessageId === row.providerMessageId
      ));
      if (duplicate) return { inserted: false, row: duplicate };
      seq += 1;
      const stored = { ...row, id: `id-${seq}` };
      rows.set(stored.id, stored);
      return { inserted: true, row: stored };
    },
    async markWebhookProcessing(id, attempts) {
      const row = rows.get(id);
      row.status = 'PROCESSING';
      row.attempts = attempts;
      return row;
    },
    async markWebhookProcessed(id) {
      const row = rows.get(id);
      row.status = 'PROCESSED';
      row.processedAt = new Date().toISOString();
    },
    async markWebhookFailed(id, patch) {
      const row = rows.get(id);
      row.status = patch.status;
      row.errorCode = patch.errorCode;
      row.errorMessage = patch.errorMessage;
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
});
