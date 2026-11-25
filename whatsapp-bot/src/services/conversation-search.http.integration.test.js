import '../db/test-env-bootstrap.js';
import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';
import { createApp } from '../create-app.js';
import { createSignedSessionToken } from './admin-auth.service.js';
import { encodeSearchCursor } from '../utils/conversation-search.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import { isConversationDbEnabled, pingDatabase } from '../db/index.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, { method = 'POST', path: reqPath, body, cookie }) {
  const payload = body == null ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    };
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
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    req.end(payload);
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

test('POST /api/conversations/search sin sesión responde 401', async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-din440';
  const app = createApp();
  const server = await listen(app);
  try {
    const res = await request(server, { path: '/api/conversations/search', body: { q: 'hola' } });
    assert.equal(res.status, 401);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('POST /api/conversations/search admin responde 200 con SQL disponible', async (t) => {
  if (!(await sqlReady())) {
    t.skip('SQL local no disponible');
    return;
  }
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-din440';
  const app = createApp();
  const server = await listen(app);
  try {
    const limitBad = await request(server, {
      path: '/api/conversations/search',
      cookie: cookieFor('admin', config.adminUsername || 'admin'),
      body: { q: 'ho', limit: 51 },
    });
    assert.equal(limitBad.status, 400);

    const ok = await request(server, {
      path: '/api/conversations/search',
      cookie: cookieFor('admin', config.adminUsername || 'admin'),
      body: { q: 'hola', groups: 'both' },
    });
    assert.equal(ok.status, 200);
    assert.match(String(ok.headers['cache-control'] || ''), /no-store/i);
    assert.ok(Array.isArray(ok.body?.data?.contacts?.items));
    assert.ok(Array.isArray(ok.body?.data?.messages?.items));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('POST /api/conversations/search conversations_only responde 200 con SQL disponible', async (t) => {
  if (!(await sqlReady())) {
    t.skip('SQL local no disponible');
    return;
  }
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-din440';
  const app = createApp();
  const server = await listen(app);
  const operator = config.conversationsOperatorUsername || 'conversations-operator';
  try {
    const res = await request(server, {
      path: '/api/conversations/search',
      cookie: cookieFor('conversations_only', operator),
      body: { q: 'hola', groups: 'messages' },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body?.data?.messages?.items));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test('POST /api/conversations/search rechaza cursor de otro término', async (t) => {
  if (!(await sqlReady())) {
    t.skip('SQL local no disponible');
    return;
  }
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-din440';
  const app = createApp();
  const server = await listen(app);
  const raw = encodeSearchCursor(
    { id: '11111111-1111-4111-8111-111111111111', createdAt: '2024-01-01T00:00:00.000Z' },
    { scope: 'message_global', q: 'hola' },
  );
  try {
    const res = await request(server, {
      path: '/api/conversations/search',
      cookie: cookieFor('admin', config.adminUsername || 'admin'),
      body: { q: 'otro', cursorMessage: raw, groups: 'messages' },
    });
    assert.equal(res.status, 400);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});