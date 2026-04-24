import crypto from 'crypto';

const COOKIE_NAME = 'tea_session';

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verifica contraseña contra ADMIN_PASSWORD_HASH (hex SHA-256 de la contraseña).
 */
export function verifyPasswordHash(plainPassword, storedHashHex) {
  if (!plainPassword || !storedHashHex || typeof storedHashHex !== 'string') return false;
  const normalized = storedHashHex.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  const digest = crypto.createHash('sha256').update(String(plainPassword), 'utf8').digest('hex');
  return timingSafeEqualStrings(digest, normalized);
}

export function createSignedSessionToken(username, sessionSecret) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ u: username, exp }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySignedSessionToken(token, sessionSecret) {
  if (!token || !sessionSecret || typeof token !== 'string') return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expectedSig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.u !== 'string' || typeof data.exp !== 'number') return null;
  if (data.exp < Date.now()) return null;
  return { username: data.u, exp: data.exp };
}

export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export function readSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}
