import { config } from '../config.js';
import {
  readSessionTokenFromRequest,
  verifySignedSessionToken,
} from '../services/admin-auth.service.js';
import { resolveRoleForUsername } from '../services/admin-users.service.js';
import { normalizeSessionRole } from '../auth/roles.js';

/**
 * Requiere cookie de sesión admin válida (firmada con SESSION_SECRET).
 */
export function requireAuth(req, res, next) {
  const token = readSessionTokenFromRequest(req);
  const session = verifySignedSessionToken(token, config.sessionSecret);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  const role = session.role ?? resolveRoleForUsername(session.username);
  req.adminUser = {
    username: session.username,
    role: normalizeSessionRole(role),
  };
  return next();
}
