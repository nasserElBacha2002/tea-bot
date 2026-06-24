export type UserRole = 'admin' | 'conversations_only';

export type AuthUser = {
  username: string;
  role: UserRole;
  agentId?: string;
};
