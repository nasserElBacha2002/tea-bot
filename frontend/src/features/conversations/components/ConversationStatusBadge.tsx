import React from 'react';
import { Chip } from '@mui/material';
import type { ConversationStatus } from '../types/conversation.types';
import { conversationStatusLabel } from '../utils/conversationUiLabels';

const STATUS_COLORS: Record<
  ConversationStatus,
  'default' | 'success' | 'warning' | 'error' | 'info' | 'primary'
> = {
  bot: 'success',
  waiting_human: 'warning',
  assigned: 'info',
  closed: 'default',
  paused: 'default',
};

interface Props {
  status: string;
  size?: 'small' | 'medium';
}

export const ConversationStatusBadge: React.FC<Props> = ({ status, size = 'small' }) => {
  const color = STATUS_COLORS[status as ConversationStatus] ?? 'default';
  return (
    <Chip
      label={conversationStatusLabel(status)}
      color={color}
      size={size}
      variant="outlined"
    />
  );
};
