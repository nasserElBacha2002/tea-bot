import type { UserRole } from '../types/auth.types';

export const ROLES = {
  ADMIN: 'admin',
  CONVERSATIONS_ONLY: 'conversations_only',
} as const satisfies Record<string, UserRole>;

export function isAdminRole(role: UserRole | undefined): boolean {
  return role === ROLES.ADMIN;
}

export function canAccessFlows(role: UserRole | undefined): boolean {
  return isAdminRole(role);
}

export function canAccessConversations(role: UserRole | undefined): boolean {
  return role === ROLES.ADMIN || role === ROLES.CONVERSATIONS_ONLY;
}

export function defaultHomePath(role: UserRole | undefined): string {
  return role === ROLES.CONVERSATIONS_ONLY ? '/conversations' : '/flows';
}

export function isFlowRoute(pathname: string): boolean {
  return pathname.startsWith('/flows') || pathname.startsWith('/admin/');
}
