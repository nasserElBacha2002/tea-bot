import '../db/test-env-bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import { testEnvBootstrapStatus } from '../db/test-env-bootstrap.js';

test('conversation search SQL integration', { skip: isolatedTestDatabaseReason() ?? false }, async () => {
  const env = testEnvBootstrapStatus();
  if (!env.hasUser || !env.hasPassword) {
    assert.fail('DB_ENV_MISSING: DB_USER, DB_PASSWORD (ver whatsapp-bot/.env)');
  }
  const { default: conversationSearchService } = await import('./conversation-search.service.js');

  const data = await conversationSearchService.searchGlobal({ q: 'hola', limit: 5 });
  assert.ok(data.contacts);
  assert.ok(data.messages);
  assert.ok(Array.isArray(data.contacts.items));
  assert.ok(Array.isArray(data.messages.items));
});