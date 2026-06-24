import React, { createContext, useContext } from 'react';
import type { AuthUser } from '../types/auth.types';

const AuthContext = createContext<AuthUser | null>(null);

export function AuthProvider({
  user,
  children,
}: {
  user: AuthUser;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

export function useAuthUser(): AuthUser | null {
  return useContext(AuthContext);
}
