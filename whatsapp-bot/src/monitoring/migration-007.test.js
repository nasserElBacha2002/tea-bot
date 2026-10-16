import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const migrationPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations/007_monitoring.sql',
);

test('migracion 007 define tablas e indice de actividad', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /provider_webhook_events/);
  assert.match(sql, /UQ_provider_webhook_events_message/);
  assert.match(sql, /message_delivery_status/);
  assert.match(sql, /monitoring_incidents/);
  assert.match(sql, /monitoring_job_status/);
  assert.match(sql, /monitoring_balance_samples/);
  assert.match(sql, /updated_at DATETIME2 NOT NULL/);
  assert.match(sql, /idx_conversation_messages_created_at_direction/);
  assert.match(sql, /idx_monitoring_incidents_status_started/);
});
