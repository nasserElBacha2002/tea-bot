import { ROLES } from '../auth/roles.js';

/**
 * Requiere rol admin (después de requireAuth).
 */
export function requireAdmin(req, res, next) {
  const role = req.adminUser?.role;
  if (role !== ROLES.ADMIN) {
    return res.status(403).json({
      ok: false,
      error: 'FORBIDDEN',
      message: 'No tenés permisos para acceder a esta función.',
    });
  }
  return next();
}
