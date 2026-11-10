import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedTestDatabaseReason } from '../src/db/isolated-test-database.js';
import { resolveTb006Command } from './tb006-preflight.js';

const production = {
  DB_SERVER: 'host.docker.internal',
  DB_NAME: 'tea_bot',
  TB006_PRODUCTION_CONFIRM: 'tea_bot',
};

test('tea_bot no entra en la allowlist de SQL TEST', () => {
  assert.match(isolatedTestDatabaseReason(production), /DB_SERVER/);
  assert.match(isolatedTestDatabaseReason({
    ...production,
    DB_SERVER: '127.0.0.1',
    TB_SQL_TEST_CONFIRM: 'tea_bot',
  }), /tea-bot o tea_bot_test_/);
});

test('inspect productivo no habilita execute ni la sonda', () => {
  assert.equal(resolveTb006Command(['--inspect'], production).ok, true);
  assert.equal(resolveTb006Command(['--execute'], production).ok, false);
  assert.equal(resolveTb006Command(['--probe'], production).reason, 'probe_not_authorized');
  assert.equal(resolveTb006Command(['--apply-010'], production).reason, 'apply_010_not_authorized');
});

test('la sonda y la 010 exigen su propia confirmación', () => {
  const probe = resolveTb006Command(['--probe'], {
    ...production,
    TB006_PROBE_CONFIRM: 'TB006_PROBE',
  });
  assert.equal(probe.ok, true);
  assert.equal(probe.mode, 'probe');
  const apply = resolveTb006Command(['--apply-010'], {
    ...production,
    TB006_APPLY_010: '010_webhook_response_body.sql',
  });
  assert.equal(apply.ok, true);
  assert.equal(apply.production, true);
  assert.equal(resolveTb006Command(['--apply-010'], {
    ...production,
    TB006_APPLY_010: '009_conversation_status_version.sql',
  }).ok, false);
});

test('una base de prueba aislada conserva execute y apply-010', () => {
  const env = {
    DB_SERVER: '127.0.0.1',
    DB_NAME: 'tea-bot',
    TB_SQL_TEST_CONFIRM: 'tea-bot',
  };
  assert.equal(resolveTb006Command(['--execute'], env).ok, true);
  assert.equal(resolveTb006Command(['--apply-010'], env).production, false);
  assert.equal(resolveTb006Command(['--inspect', '--probe'], env).reason, 'mode_ambiguous');
});

test('010 solo agrega response_body nullable', () => {
  const sql = fs.readFileSync(new URL('../migrations/010_webhook_response_body.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD response_body NVARCHAR\(MAX\) NULL/);
  assert.equal(/\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i.test(sql), false);
});
