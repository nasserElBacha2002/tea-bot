import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(__dirname, '005_contact_email.sql');

test('005_contact_email migration is idempotent and adds contact_email column', async () => {
  const sql = await fs.readFile(migrationPath, 'utf8');
  assert.match(sql, /contact_email/i);
  assert.match(sql, /COL_LENGTH\('dbo\.conversations', 'contact_email'\)/);
  assert.match(sql, /idx_conversations_contact_email/);
  assert.doesNotMatch(sql, /DROP TABLE/i);
});
