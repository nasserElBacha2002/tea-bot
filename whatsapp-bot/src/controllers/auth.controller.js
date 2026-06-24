import { config } from '../config.js';
import {
  createSignedSessionToken,
  getSessionCookieName,
  readSessionTokenFromRequest,
  verifySignedSessionToken,
} from '../services/admin-auth.service.js';
import { authenticateAdminUser } from '../services/admin-users.service.js';
import { resolveAgentIdFromUsername } from '../utils/agent-identity.js';
import { normalizeSessionRole } from '../auth/roles.js';

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

function buildAuthUser(session) {
  const role = normalizeSessionRole(session.role);
  return {
    username: session.username,
    role,
    agentId: resolveAgentIdFromUsername(session.username),
  };
}

export const login = (req, res) => {
  const { username, password } = req.body || {};
  const authenticated = authenticateAdminUser(username, password);

  if (!authenticated) {
    return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
  }

  const token = createSignedSessionToken(
    authenticated.username,
    config.sessionSecret,
    authenticated.role,
  );
  res.setHeader('Set-Cookie', buildSessionCookieHeader(token, 7 * 24 * 60 * 60));
  return res.json({
    ok: true,
    user: {
      username: authenticated.username,
      role: authenticated.role,
      agentId: resolveAgentIdFromUsername(authenticated.username),
    },
  });
};

export const me = (req, res) => {
  const token = readSessionTokenFromRequest(req);
  const session = verifySignedSessionToken(token, config.sessionSecret);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  return res.json({
    ok: true,
    user: buildAuthUser(session),
  });
};

export const logout = (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return res.json({ ok: true });
};
