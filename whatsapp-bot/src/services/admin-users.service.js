import crypto from 'crypto';
import { config } from '../config.js';
import { ROLES } from '../auth/roles.js';
import { verifyPasswordHash } from './admin-auth.service.js';

function timingSafeUser(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * @typedef {{ username: string, role: import('../auth/roles.js').UserRole }} AuthenticatedAdminUser
 */

/**
 * @param {string} username
 * @param {string} password
 * @returns {AuthenticatedAdminUser | null}
 */
export function authenticateAdminUser(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const trimmed = username.trim();

  if (
    config.adminUsername
    && timingSafeUser(trimmed, config.adminUsername)
    && verifyPasswordHash(password, config.adminPasswordHash)
  ) {
    return { username: config.adminUsername, role: ROLES.ADMIN };
  }

  if (
    config.conversationsOperatorUsername
    && config.conversationsOperatorPasswordHash
    && timingSafeUser(trimmed, config.conversationsOperatorUsername)
    && verifyPasswordHash(password, config.conversationsOperatorPasswordHash)
  ) {
    return {
      username: config.conversationsOperatorUsername,
      role: ROLES.CONVERSATIONS_ONLY,
    };
  }

  return null;
}

/**
 * @param {string} username
 * @returns {import('../auth/roles.js').UserRole | null}
 */
export function resolveRoleForUsername(username) {
  if (!username) return null;
  if (config.adminUsername && timingSafeUser(username, config.adminUsername)) {
    return ROLES.ADMIN;
  }
  if (
    config.conversationsOperatorUsername
    && timingSafeUser(username, config.conversationsOperatorUsername)
  ) {
    return ROLES.CONVERSATIONS_ONLY;
  }
  return null;
}
