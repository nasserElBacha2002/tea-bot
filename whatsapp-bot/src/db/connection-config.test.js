import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSqlServerEnv,
  buildMssqlConfig,
  isConversationDbEnabled,
} from './connection-config.js';

test('validateSqlServerEnv exige server, database, user y password', () => {
  const prev = {
    DB_SERVER: process.env.DB_SERVER,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD,
  };

  delete process.env.DB_SERVER;
  process.env.DB_NAME = 'tea_bot';
  process.env.DB_USER = 'sa';
  process.env.DB_PASSWORD = 'secret';

  const missing = validateSqlServerEnv();
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.includes('DB_SERVER'));

  process.env.DB_SERVER = 'localhost';
  const ok = validateSqlServerEnv();
  assert.equal(ok.ok, true);
  assert.equal(ok.env.database, 'tea_bot');

  if (prev.DB_SERVER === undefined) delete process.env.DB_SERVER;
  else process.env.DB_SERVER = prev.DB_SERVER;
  if (prev.DB_NAME === undefined) delete process.env.DB_NAME;
  else process.env.DB_NAME = prev.DB_NAME;
  if (prev.DB_USER === undefined) delete process.env.DB_USER;
  else process.env.DB_USER = prev.DB_USER;
  if (prev.DB_PASSWORD === undefined) delete process.env.DB_PASSWORD;
  else process.env.DB_PASSWORD = prev.DB_PASSWORD;
});

test('buildMssqlConfig arma opciones desde entorno', () => {
  const keys = [
    'DB_SERVER',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'DB_ENCRYPT',
    'DB_TRUST_SERVER_CERTIFICATE',
  ];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  process.env.DB_SERVER = 'sql.example.com';
  process.env.DB_PORT = '1433';
  process.env.DB_NAME = 'tea_bot';
  process.env.DB_USER = 'app_user';
  process.env.DB_PASSWORD = 'p@ss';
  process.env.DB_ENCRYPT = 'false';
  process.env.DB_TRUST_SERVER_CERTIFICATE = 'true';

  const cfg = buildMssqlConfig();
  assert.equal(cfg.server, 'sql.example.com');
  assert.equal(cfg.port, 1433);
  assert.equal(cfg.database, 'tea_bot');
  assert.equal(cfg.user, 'app_user');
  assert.equal(cfg.options.trustServerCertificate, true);
  assert.equal(cfg.options.encrypt, false);

  for (const k of keys) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
});

test('isConversationDbEnabled reconoce valores truthy', () => {
  const prev = process.env.CONVERSATION_DB_ENABLED;
  process.env.CONVERSATION_DB_ENABLED = 'yes';
  assert.equal(isConversationDbEnabled(), true);
  process.env.CONVERSATION_DB_ENABLED = '0';
  assert.equal(isConversationDbEnabled(), false);
  if (prev === undefined) delete process.env.CONVERSATION_DB_ENABLED;
  else process.env.CONVERSATION_DB_ENABLED = prev;
});
