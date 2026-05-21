import test from 'node:test';
import assert from 'node:assert/strict';
import messagePersistence from './message-persistence.service.js';

test('messagePersistence.isEnabled refleja CONVERSATION_DB_ENABLED', () => {
  const previous = process.env.CONVERSATION_DB_ENABLED;
  process.env.CONVERSATION_DB_ENABLED = '';
  assert.equal(messagePersistence.isEnabled(), false);
  process.env.CONVERSATION_DB_ENABLED = 'true';
  assert.equal(messagePersistence.isEnabled(), true);
  if (previous === undefined) {
    delete process.env.CONVERSATION_DB_ENABLED;
  } else {
    process.env.CONVERSATION_DB_ENABLED = previous;
  }
});

test('safeRun no relanza cuando DB falla y strict desactivado', async () => {
  const previousStrict = process.env.CONVERSATION_DB_STRICT;
  const previousEnabled = process.env.CONVERSATION_DB_ENABLED;
  process.env.CONVERSATION_DB_STRICT = '0';
  process.env.CONVERSATION_DB_ENABLED = 'true';
  process.env.DB_SERVER = '';
  process.env.DB_NAME = 'tea_bot';
  process.env.DB_USER = 'sa';
  process.env.DB_PASSWORD = 'x';

  const result = await messagePersistence.safeRun('test', async () => {
    throw new Error('db down');
  });

  assert.equal(result, null);

  if (previousStrict === undefined) delete process.env.CONVERSATION_DB_STRICT;
  else process.env.CONVERSATION_DB_STRICT = previousStrict;
  if (previousEnabled === undefined) delete process.env.CONVERSATION_DB_ENABLED;
  else process.env.CONVERSATION_DB_ENABLED = previousEnabled;
});
