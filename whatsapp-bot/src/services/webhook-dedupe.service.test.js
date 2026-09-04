import test from 'node:test';
import assert from 'node:assert/strict';
import webhookDedupe from './webhook-dedupe.service.js';

test('webhook duplicado del mismo message SID se ignora', async () => {
  const key = webhookDedupe.buildProviderMessageKey(
    'twilio',
    `SM-first-contact-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  );
  assert.equal(await webhookDedupe.isDuplicate(key), false);
  await webhookDedupe.markProcessed(key);
  assert.equal(await webhookDedupe.isDuplicate(key), true);
});
