import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import type { LiveConnectionStatus } from '../hooks/useConversationsLiveUpdates';

const CONFIG: Record<
  LiveConnectionStatus,
  { label: string; color: 'success' | 'warning' | 'default' | 'error' }
> = {
  live: { label: 'En vivo', color: 'success' },
  reconnecting: { label: 'Reconectando…', color: 'warning' },
  manual: { label: 'Actualización manual', color: 'default' },
  disconnected: { label: 'Sin conexión en tiempo real', color: 'error' },
};

interface Props {
  status: LiveConnectionStatus;
}

export const ConversationLiveIndicator: React.FC<Props> = ({ status }) => {
  const cfg = CONFIG[status];
  return (
    <Tooltip title="Estado de actualización en tiempo real de la bandeja">
      <Chip size="small" label={cfg.label} color={cfg.color} variant="outlined" sx={{ fontSize: 11 }} />
    </Tooltip>
  );
};
