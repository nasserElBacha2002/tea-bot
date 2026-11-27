import { createContext, useContext } from 'react';
import type { AuthUser } from '../types/auth.types';

export const AuthUserContext = createContext<AuthUser | null>(null);

export function useAuthUser(): AuthUser | null {
  return useContext(AuthUserContext);
}