import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const sql = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '003_flows_schema.sql'),
  'utf-8',
);

test('migracion 003 crea tablas de flujos', () => {
  assert.match(sql, /dbo\.flows/i);
  assert.match(sql, /dbo\.flow_versions/i);
  assert.match(sql, /dbo\.flow_nodes/i);
  assert.match(sql, /dbo\.flow_transitions/i);
  assert.match(sql, /dbo\.flow_version_snapshots/i);
  assert.match(sql, /snapshot_json/i);
});
