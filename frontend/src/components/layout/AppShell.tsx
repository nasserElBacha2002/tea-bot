import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AppBar, Box, Toolbar, Typography, Button, IconButton, Tooltip } from '@mui/material';
import { BubbleChart, Forum, VolumeOff, VolumeUp } from '@mui/icons-material';
import { authApi } from '../../features/auth/api/authApi';
import { useAuthUser } from '../../features/auth/context/AuthContext';
import { canAccessFlows, canAccessConversations, defaultHomePath } from '../../features/auth/utils/authPermissions';
import { ConversationLiveProvider } from '../../features/conversations/context/ConversationLiveProvider';
import { useConversationLive } from '../../features/conversations/context/conversationLiveContext';

const AppShellToolbar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthUser();
  const [loggingOut, setLoggingOut] = useState(false);
  const showFlows = canAccessFlows(user?.role);
  const showConversationAlerts = canAccessConversations(user?.role);
  const homePath = defaultHomePath(user?.role);
  const live = useConversationLive();

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
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        maxHeight: '100%',
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <AppBar position="static" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary' }}>
        <Toolbar sx={{ gap: 1 }}>
          <BubbleChart color="primary" />
          <Typography
            variant="h6"
            fontWeight={800}
            sx={{ flex: 1, cursor: 'pointer' }}
            onClick={() => navigate(homePath)}
          >
            {showFlows ? 'Administración Tea Bot' : 'Conversaciones Tea Bot'}
          </Typography>
          <Button
            variant={location.pathname.startsWith('/conversations') ? 'contained' : 'text'}
            size="small"
            startIcon={<Forum />}
            onClick={() => navigate('/conversations')}
          >
            Conversaciones
          </Button>
          {showConversationAlerts ? (
            <Tooltip
              title={
                live.soundBlocked
                  ? 'Sonido bloqueado por el navegador. Clic para activar alertas.'
                  : live.soundAlertsEnabled
                    ? 'Desactivar alertas sonoras'
                    : 'Activar alertas sonoras'
              }
            >
              <IconButton
                size="small"
                color={live.soundBlocked ? 'warning' : live.soundAlertsEnabled ? 'primary' : 'default'}
                aria-label="Alertas sonoras de conversaciones"
                onClick={() => {
                  if (live.soundBlocked) {
                    void live.unlockSound();
                    return;
                  }
                  live.setSoundAlertsEnabled(!live.soundAlertsEnabled);
                }}
              >
                {live.soundAlertsEnabled && !live.soundBlocked ? <VolumeUp fontSize="small" /> : <VolumeOff fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}
          {showFlows ? (
            <Button
              variant={location.pathname.startsWith('/flows') ? 'contained' : 'text'}
              size="small"
              onClick={() => navigate('/flows')}
            >
              Flujos
            </Button>
          ) : null}
          <Button variant="outlined" size="small" onClick={handleLogout} disabled={loggingOut}>
            Cerrar sesión
          </Button>
        </Toolbar>
      </AppBar>
      <Box
        component="main"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
};

export const AppShell: React.FC = () => {
  return (
    <ConversationLiveProvider>
      <AppShellToolbar />
    </ConversationLiveProvider>
  );
};
