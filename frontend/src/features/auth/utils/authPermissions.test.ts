import { describe, expect, it } from 'vitest';
import {
  canAccessConversations,
  canAccessFlows,
  defaultHomePath,
  isFlowRoute,
  ROLES,
} from './authPermissions';

describe('authPermissions', () => {
  it('admin accede a flujos y cae en /flows', () => {
    expect(canAccessFlows(ROLES.ADMIN)).toBe(true);
    expect(defaultHomePath(ROLES.ADMIN)).toBe('/flows');
  });

  it('conversations_only no accede a flujos y cae en /conversations', () => {
    expect(canAccessFlows(ROLES.CONVERSATIONS_ONLY)).toBe(false);
    expect(canAccessConversations(ROLES.CONVERSATIONS_ONLY)).toBe(true);
    expect(defaultHomePath(ROLES.CONVERSATIONS_ONLY)).toBe('/conversations');
  });

  it('admin también accede a conversaciones', () => {
    expect(canAccessConversations(ROLES.ADMIN)).toBe(true);
  });

  it('detecta rutas de flujos', () => {
    expect(isFlowRoute('/flows')).toBe(true);
    expect(isFlowRoute('/flows/main-menu/conversation')).toBe(true);
    expect(isFlowRoute('/admin/flows')).toBe(true);
    expect(isFlowRoute('/conversations')).toBe(false);
  });
});
