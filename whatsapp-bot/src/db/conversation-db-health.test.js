import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureConversationDbReady } from './conversation-db-health.js';

test('ensureConversationDbReady rechaza cuando persistencia deshabilitada explicitamente', async () => {
  const keys = [
    'CONVERSATION_DB_ENABLED',
    'DB_SERVER',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
  ];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  process.env.CONVERSATION_DB_ENABLED = 'false';
  for (const k of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    delete process.env[k];
  }

  await assert.rejects(
    () => ensureConversationDbReady(),
    (err) => {
      assert.equal(err.code, 'CONVERSATION_PERSISTENCE_UNAVAILABLE');
      assert.equal(err.details?.cause, 'CONVERSATION_DB_DISABLED');
      return true;
    },
  );

  for (const k of keys) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
});
