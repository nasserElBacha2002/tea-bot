import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AppBar, Box, Toolbar, Typography, Button } from '@mui/material';
import { BubbleChart } from '@mui/icons-material';
import { authApi } from '../../features/auth/api/authApi';

export const AppShell: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } finally {
      setLoggingOut(false);
      navigate('/login', { replace: true });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ gap: 1 }}>
          <BubbleChart color="primary" />
          <Typography variant="h6" fontWeight={800} sx={{ flex: 1, cursor: 'pointer' }} onClick={() => navigate('/flows')}>
            Administración Tea Bot
          </Typography>
          <Button
            variant={location.pathname.startsWith('/flows') ? 'contained' : 'text'}
            size="small"
            onClick={() => navigate('/flows')}
          >
            Flujos
          </Button>
          <Button variant="outlined" size="small" onClick={handleLogout} disabled={loggingOut}>
            Cerrar sesión
          </Button>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </Box>
    </Box>
  );
};
