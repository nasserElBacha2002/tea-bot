import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('la migracion 011 crea conversation_message_attachments', () => {
  const sql = fs.readFileSync(
    fileURLToPath(new URL('../../migrations/011_conversation_message_attachments.sql', import.meta.url)),
    'utf8',
  );
  assert.match(sql, /conversation_message_attachments/);
  assert.match(sql, /UQ_conversation_message_attachments_message_ordinal/);
  assert.equal(sql.includes('DROP '), false);
});