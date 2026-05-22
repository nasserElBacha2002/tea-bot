import React from 'react';
import { Chip } from '@mui/material';
import type { FlowVersionStatus } from '../types/flowManagement.types';

const LABELS: Record<FlowVersionStatus, string> = {
  published: 'Publicada',
  draft: 'Borrador',
  archived: 'Archivada',
};

const COLORS: Record<FlowVersionStatus, 'success' | 'warning' | 'default'> = {
  published: 'success',
  draft: 'warning',
  archived: 'default',
};

export const FlowVersionStatusBadge: React.FC<{ status: FlowVersionStatus | string }> = ({
  status,
}) => {
  const key = status as FlowVersionStatus;
  return (
    <Chip
      size="small"
      label={LABELS[key] || status}
      color={COLORS[key] || 'default'}
      variant={key === 'draft' ? 'outlined' : 'filled'}
    />
  );
};
