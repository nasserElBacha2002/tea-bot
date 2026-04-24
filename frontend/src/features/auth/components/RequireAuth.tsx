import React, { useEffect, useState } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet } from 'react-router-dom';
import { authApi } from '../api/authApi';

export const RequireAuth: React.FC = () => {
  const [state, setState] = useState<'loading' | 'ok' | 'no'>('loading');

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(() => {
        if (!cancelled) setState('ok');
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

  if (state === 'no') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
