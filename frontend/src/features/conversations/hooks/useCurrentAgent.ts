import { useQuery } from '@tanstack/react-query';
import { authApi } from '../../auth/api/authApi';
import { useAuthUser } from '../../auth/context/AuthContext';
import { isAdminRole } from '../../auth/utils/authPermissions';

export function useCurrentAgent() {
  const authUser = useAuthUser();
  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 5 * 60_000,
  });

  const agentId = authUser?.agentId ?? meQuery.data?.user?.agentId ?? null;
  const username = authUser?.username ?? meQuery.data?.user?.username ?? null;
  const role = authUser?.role ?? meQuery.data?.user?.role;
  const loading = !agentId && meQuery.isLoading;

  return {
    agentId,
    username,
    role,
    isAdmin: isAdminRole(role),
    loading,
  };
}
