import React from 'react';
import type { AuthUser } from '../types/auth.types';
import { AuthUserContext } from './authUserContext';

export function AuthProvider({
  user,
  children,
}: {
  user: AuthUser;
  children: React.ReactNode;
}) {
  return <AuthUserContext.Provider value={user}>{children}</AuthUserContext.Provider>;
}