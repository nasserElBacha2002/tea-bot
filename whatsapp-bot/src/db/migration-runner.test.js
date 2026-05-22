import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSqlBatches, listMigrationFiles } from './migration-runner.js';

test('splitSqlBatches separa por GO', () => {
  const sql = 'SELECT 1;\nGO\nSELECT 2;';
  const batches = splitSqlBatches(sql);
  assert.equal(batches.length, 2);
});

test('listMigrationFiles devuelve solo .sql ordenados', async () => {
  const files = await listMigrationFiles();
  assert.ok(files.length >= 1);
  assert.ok(files.every((f) => f.endsWith('.sql')));
  const sorted = [...files].sort();
  assert.deepEqual(files, sorted);
});
