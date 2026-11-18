import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('la migracion 012 endurece conversation_message_attachments sin tocar 011', () => {
  const sql = fs.readFileSync(
    fileURLToPath(new URL('../../migrations/012_conversation_message_attachments_hardening.sql', import.meta.url)),
    'utf8',
  );
  assert.match(sql, /source_url/);
  assert.match(sql, /CK_conversation_message_attachments_status/);
  assert.match(sql, /trg_conversation_message_attachments_conversation_match/);
  assert.equal(sql.includes('DROP TABLE dbo.conversation_message_attachments'), false);
});