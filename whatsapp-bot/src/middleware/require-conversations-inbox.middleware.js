import { ROLES } from '../auth/roles.js';

/**
 * Misma regla que el inbox en frontend: admin o conversations_only.
 * Usar después de requireAuth en rutas /api/conversations.
 */
export function requireConversationsInbox(req, res, next) {
  const role = req.adminUser?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.CONVERSATIONS_ONLY) {
    return res.status(403).json({
      ok: false,
      error: 'FORBIDDEN',
      message: 'No tenés permiso para acceder al inbox de conversaciones.',
    });
  }
  return next();
}