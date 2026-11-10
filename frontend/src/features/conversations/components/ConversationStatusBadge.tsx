import React from 'react';
import { Chip } from '@mui/material';
import type { ConversationStatus } from '../types/conversation.types';
import { conversationRecordStatusLabel } from '../utils/conversationUiLabels';

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
      label={conversationRecordStatusLabel(status)}
      color={color}
      size={size}
      variant="outlined"
      sx={{
        height: size === 'small' ? 22 : 28,
        fontSize: size === 'small' ? '0.6875rem' : '0.75rem',
        '& .MuiChip-label': { px: size === 'small' ? 0.75 : 1 },
      }}
    />
  );
};
