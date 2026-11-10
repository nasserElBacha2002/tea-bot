import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exclusiveAgentIdentityConflict } from './exclusive-agent-identity.js';
import { resolveAgentIdFromUsername } from './agent-identity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHARED_ID = '11111111-2222-4333-8444-555555555555';

test('sin INTERNAL_AGENT_ID dos usuarios son agentes distintos', () => {
  const previous = process.env.INTERNAL_AGENT_ID;
  delete process.env.INTERNAL_AGENT_ID;
  try {
    assert.equal(exclusiveAgentIdentityConflict({
      ADMIN_USERNAME: 'admin-identity',
      CONVERSATIONS_OPERATOR_USERNAME: 'operator-identity',
    }), null);
    assert.notEqual(
      resolveAgentIdFromUsername('admin-identity'),
      resolveAgentIdFromUsername('operator-identity'),
    );
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_AGENT_ID;
    else process.env.INTERNAL_AGENT_ID = previous;
  }
});

test('INTERNAL_AGENT_ID colapsa administrador y operador sin revelar el valor', () => {
  const conflict = exclusiveAgentIdentityConflict({
    ADMIN_USERNAME: 'admin-identity',
    CONVERSATIONS_OPERATOR_USERNAME: 'operator-identity',
    INTERNAL_AGENT_ID: SHARED_ID,
  });
  assert.equal(conflict?.code, 'SHARED_AGENT_IDENTITY');
  assert.equal(JSON.stringify(conflict).includes(SHARED_ID), false);
  assert.equal(exclusiveAgentIdentityConflict({
    ADMIN_USERNAME: 'admin-identity',
    CONVERSATIONS_OPERATOR_USERNAME: 'admin-identity',
    INTERNAL_AGENT_ID: SHARED_ID,
  }), null);
});

test('el arranque se detiene si la toma exclusiva comparte identidad', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { validateConfig } from './src/config.js';
    validateConfig();
    console.log('BOOTED');
  `], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TWILIO_SIGNATURE_MODE: 'off',
      MANUAL_TAKEOVER_ENABLED: 'true',
      INTERNAL_AGENT_ID: SHARED_ID,
      ADMIN_USERNAME: 'admin-identity',
      ADMIN_PASSWORD_HASH: 'ab'.repeat(32),
      CONVERSATIONS_OPERATOR_USERNAME: 'operator-identity',
      CONVERSATIONS_OPERATOR_PASSWORD_HASH: 'cd'.repeat(32),
      SESSION_SECRET: 'session-secret-test-value-32bytes',
    },
    encoding: 'utf8',
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(output.includes('BOOTED'), false);
  assert.equal(output.includes('sean el mismo agente'), true);
  assert.equal(output.includes(SHARED_ID), false);
});
