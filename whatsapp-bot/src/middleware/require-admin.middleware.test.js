import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../middleware/require-admin.middleware.js';
import { ROLES } from '../auth/roles.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('requireAdmin permite admin', () => {
  const req = { adminUser: { username: 'admin', role: ROLES.ADMIN } };
  const res = mockRes();
  let nextCalled = false;
  requireAdmin(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('requireAdmin rechaza conversations_only', () => {
  const req = { adminUser: { username: 'op', role: ROLES.CONVERSATIONS_ONLY } };
  const res = mockRes();
  let nextCalled = false;
  requireAdmin(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error, 'FORBIDDEN');
});
