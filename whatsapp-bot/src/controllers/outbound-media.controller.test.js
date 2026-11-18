import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../create-app.js';
import { createOutboundMediaGrant } from '../utils/outbound-media-grant.js';
import { writeInboundMediaObject } from '../utils/inbound-media-storage.js';
import { config } from '../config.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, { method = 'GET', path: reqPath }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: reqPath },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('GET y HEAD en URL temporal de outbound media', async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tea-out-http-'));
  const prevDir = config.inboundMediaStorageDir;
  config.inboundMediaStorageDir = tmp;
  const storageKey = 'aa'.repeat(32);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  await writeInboundMediaObject(tmp, storageKey, png);
  const { token } = createOutboundMediaGrant({
    storageKey,
    mimeType: 'application/pdf',
    originalName: 'comprobante.pdf',
  });
  const expired = createOutboundMediaGrant({
    storageKey,
    mimeType: 'image/png',
    expiresAtMs: Date.now() - 10,
  });

  const app = createApp();
  const server = await listen(app);
  try {
    const pathOk = `/media/outbound/${encodeURIComponent('comprobante.pdf')}/${encodeURIComponent(token)}`;
    const head = await request(server, { method: 'HEAD', path: pathOk });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-type'], 'application/pdf');
    assert.match(String(head.headers['content-disposition'] || ''), /comprobante\.pdf/i);
    assert.equal(head.headers['content-length'], String(png.length));

    const get = await request(server, { path: pathOk });
    assert.equal(get.status, 200);
    assert.equal(get.body.length, png.length);

    const tampered = createOutboundMediaGrant({ storageKey, mimeType: 'image/png' }).token;
    const bad = await request(server, {
      path: `/media/outbound/${encodeURIComponent(`${tampered}x`)}`,
    });
    assert.equal(bad.status, 403);

    const gone = await request(server, {
      path: `/media/outbound/${encodeURIComponent(expired.token)}`,
    });
    assert.equal(gone.status, 410);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    config.inboundMediaStorageDir = prevDir;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});