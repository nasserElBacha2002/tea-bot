/** @typedef {'admin' | 'conversations_only'} UserRole */

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  CONVERSATIONS_ONLY: 'conversations_only',
});

/**
 * @param {unknown} role
 * @returns {role is UserRole}
 */
export function isUserRole(role) {
  return role === ROLES.ADMIN || role === ROLES.CONVERSATIONS_ONLY;
}

/**
 * Tokens legacy sin campo `r` se tratan como admin.
 * @param {unknown} role
 * @returns {UserRole}
 */
export function normalizeSessionRole(role) {
  if (role === ROLES.CONVERSATIONS_ONLY) return ROLES.CONVERSATIONS_ONLY;
  return ROLES.ADMIN;
}

/**
 * @param {UserRole} role
 */
export function isAdminRole(role) {
  return normalizeSessionRole(role) === ROLES.ADMIN;
}

/**
 * @param {UserRole} role
 */
export function canAccessConversations(role) {
  return isAdminRole(role) || normalizeSessionRole(role) === ROLES.CONVERSATIONS_ONLY;
}

/**
 * @param {UserRole} role
 */
export function canAccessFlowManagement(role) {
  return isAdminRole(role);
}

/**
 * Tomar una conversación atendida por el bot, en cola o en reentrada.
 * Admin y operador de conversaciones. Un rol desconocido no hereda el permiso.
 * @param {unknown} role
 */
export function canTakeoverConversation(role) {
  return role === ROLES.ADMIN || role === ROLES.CONVERSATIONS_ONLY;
}

/**
 * Reasignar una conversación que ya tiene dueño. Operación distinta de la toma.
 * @param {unknown} role
 */
export function canReassignConversation(role) {
  return role === ROLES.ADMIN;
}
