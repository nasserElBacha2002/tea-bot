import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOutboundMediaGrant,
  verifyOutboundMediaGrant,
  buildTwilioFetchableOutboundMediaUrl,
} from './outbound-media-grant.js';

test('grant round-trip y expiración', () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
  const exp = Date.now() + 60_000;
  const { token } = createOutboundMediaGrant({
    storageKey: 'a'.repeat(32),
    mimeType: 'image/png',
    expiresAtMs: exp,
  });
  const parsed = verifyOutboundMediaGrant(token);
  assert.equal(parsed.storageKey, 'a'.repeat(32));
  assert.equal(parsed.mimeType, 'image/png');
  assert.throws(() => verifyOutboundMediaGrant(token.replace(/.$/, 'x')), /grant_invalid/);
  const expired = createOutboundMediaGrant({
    storageKey: 'b'.repeat(32),
    mimeType: 'image/jpeg',
    expiresAtMs: Date.now() - 1,
  });
  assert.throws(() => verifyOutboundMediaGrant(expired.token), /grant_expired/);
  const url = buildTwilioFetchableOutboundMediaUrl(token);
  assert.match(url, /^http:\/\/127\.0\.0\.1:3000\/media\/outbound\//);
});