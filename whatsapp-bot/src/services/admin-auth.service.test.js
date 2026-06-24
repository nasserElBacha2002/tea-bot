import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  createSignedSessionToken,
  verifyPasswordHash,
  verifySignedSessionToken,
} from './admin-auth.service.js';
import { authenticateAdminUser } from './admin-users.service.js';
import { config } from '../config.js';
import { ROLES } from '../auth/roles.js';

const SECRET = 'x'.repeat(32);

test('createSignedSessionToken incluye rol y lo verifica', () => {
  const token = createSignedSessionToken('operator', SECRET, ROLES.CONVERSATIONS_ONLY);
  const session = verifySignedSessionToken(token, SECRET);
  assert.equal(session?.username, 'operator');
  assert.equal(session?.role, ROLES.CONVERSATIONS_ONLY);
});

test('token legacy sin rol se trata como admin', () => {
  const exp = Date.now() + 60_000;
  const payload = Buffer.from(JSON.stringify({ u: 'admin', exp }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const session = verifySignedSessionToken(`${payload}.${sig}`, SECRET);
  assert.equal(session?.role, ROLES.ADMIN);
});

test('authenticateAdminUser distingue admin y operador de conversaciones', () => {
  const adminPass = 'AdminPass123!';
  const operatorPass = 'OperatorPass123!';
  const adminHash = crypto.createHash('sha256').update(adminPass, 'utf8').digest('hex');
  const operatorHash = crypto.createHash('sha256').update(operatorPass, 'utf8').digest('hex');

  const saved = {
    adminUsername: config.adminUsername,
    adminPasswordHash: config.adminPasswordHash,
    conversationsOperatorUsername: config.conversationsOperatorUsername,
    conversationsOperatorPasswordHash: config.conversationsOperatorPasswordHash,
  };

  config.adminUsername = 'admin-user';
  config.adminPasswordHash = adminHash;
  config.conversationsOperatorUsername = 'conv-operator';
  config.conversationsOperatorPasswordHash = operatorHash;

  try {
    const admin = authenticateAdminUser('admin-user', adminPass);
    assert.equal(admin?.role, ROLES.ADMIN);

    const operator = authenticateAdminUser('conv-operator', operatorPass);
    assert.equal(operator?.role, ROLES.CONVERSATIONS_ONLY);

    assert.equal(authenticateAdminUser('conv-operator', adminPass), null);
    assert.equal(authenticateAdminUser('admin-user', operatorPass), null);
  } finally {
    config.adminUsername = saved.adminUsername;
    config.adminPasswordHash = saved.adminPasswordHash;
    config.conversationsOperatorUsername = saved.conversationsOperatorUsername;
    config.conversationsOperatorPasswordHash = saved.conversationsOperatorPasswordHash;
  }
});

test('verifyPasswordHash valida SHA-256 hex', () => {
  const hash = crypto.createHash('sha256').update('secret', 'utf8').digest('hex');
  assert.equal(verifyPasswordHash('secret', hash), true);
  assert.equal(verifyPasswordHash('wrong', hash), false);
});
