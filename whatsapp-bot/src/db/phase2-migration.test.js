import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(__dirname, '../../migrations/002_human_handoffs.sql');

test('migracion 002 define human_handoffs e indices', () => {
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  assert.match(sql, /human_handoffs/i);
  assert.match(sql, /idx_human_handoffs_conversation_id/i);
  assert.match(sql, /idx_human_handoffs_status_requested_at/i);
  assert.match(sql, /idx_conversations_status_last_message/i);
  assert.match(sql, /requested_by/i);
  assert.match(sql, /status.*pending/i);
});
