import '../db/test-env-bootstrap.js';
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { createApp } from '../create-app.js';
import { createSignedSessionToken } from '../services/admin-auth.service.js';
import { isConversationDbEnabled, pingDatabase } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, { method = 'GET', path: reqPath, cookie }) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    const req = http.request({
      port: server.address().port,
      host: '127.0.0.1',
      path: reqPath,
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function cookieFor(role, username) {
  const token = createSignedSessionToken(username, config.sessionSecret, role);
  return `tea_session=${token}`;
}

async function sqlReady() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return false;
  if (!isConversationDbEnabled()) return false;
  const ping = await pingDatabase();
  return ping.ok;
}

test('GET /api/monitoring/operational-summary sin sesión responde 401', async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-din430';
  const app = createApp();
  const server = await listen(app);
  try {
    const res = await request(server, { path: '/api/monitoring/operational-summary?period=7d' });
    assert.equal(res.status, 401);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('GET /api/monitoring/operational-summary conversations_only responde 403', async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-din430';
  const app = createApp();
  const server = await listen(app);
  try {
    const res = await request(server, {
      path: '/api/monitoring/daily-metrics?period=7d',
      cookie: cookieFor('conversations_only', 'operator'),
    });
    assert.equal(res.status, 403);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('GET /api/monitoring/daily-metrics admin responde 200 con SQL', async (t) => {
  if (!(await sqlReady())) {
    t.skip('SQL local no disponible');
    return;
  }
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-din430';
  const app = createApp();
  const server = await listen(app);
  try {
    const bad = await request(server, {
      path: '/api/monitoring/daily-metrics?days=500',
      cookie: cookieFor('admin', config.adminUsername || 'admin'),
    });
    assert.equal(bad.status, 400);

    const ok = await request(server, {
      path: '/api/monitoring/daily-metrics?period=7d',
      cookie: cookieFor('admin', config.adminUsername || 'admin'),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.ok(Array.isArray(ok.body.daily));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});