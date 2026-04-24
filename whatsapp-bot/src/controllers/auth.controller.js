import { config } from '../config.js';
import {
  createSignedSessionToken,
  getSessionCookieName,
  readSessionTokenFromRequest,
  verifyPasswordHash,
  verifySignedSessionToken,
} from '../services/admin-auth.service.js';
import crypto from 'crypto';

function timingSafeUser(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function buildSessionCookieHeader(token, maxAgeSec) {
  const name = getSessionCookieName();
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (config.isProduction) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function clearSessionCookieHeader() {
  const name = getSessionCookieName();
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (config.isProduction) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export const login = (req, res) => {
  const { username, password } = req.body || {};

  const userOk =
    typeof username === 'string'
    && typeof config.adminUsername === 'string'
    && timingSafeUser(username.trim(), config.adminUsername);
  const passOk = verifyPasswordHash(password, config.adminPasswordHash);

  if (!userOk || !passOk) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }

  const token = createSignedSessionToken(config.adminUsername, config.sessionSecret);
  res.setHeader('Set-Cookie', buildSessionCookieHeader(token, 7 * 24 * 60 * 60));
  return res.json({ ok: true, user: { username: config.adminUsername } });
};

export const me = (req, res) => {
  const token = readSessionTokenFromRequest(req);
  const session = verifySignedSessionToken(token, config.sessionSecret);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  return res.json({ ok: true, user: { username: session.username } });
};

export const logout = (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return res.json({ ok: true });
};
