import React, { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet } from 'react-router-dom';
import { authApi } from '../api/authApi';
import { AuthProvider } from '../context/AuthContext';
import type { AuthUser } from '../types/auth.types';
import { defaultHomePath, isFlowRoute } from '../utils/authPermissions';

export const RequireAuth: React.FC = () => {
  const [state, setState] = useState<'loading' | 'ok' | 'no'>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then((res) => {
        if (!cancelled) {
          setUser(res.user);
          setState('ok');
        }
      })
      .catch(() => {
        if (!cancelled) setState('no');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (state === 'no' || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'conversations_only' && isFlowRoute(window.location.pathname)) {
    return <Navigate to={defaultHomePath(user.role)} replace />;
  }

  return (
    <AuthProvider user={user}>
      <Outlet />
    </AuthProvider>
  );
};
