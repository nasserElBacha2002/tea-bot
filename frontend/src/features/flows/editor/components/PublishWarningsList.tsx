import React from 'react';
import { Alert, List, ListItem, Typography } from '@mui/material';
import type { PublishWarningItem } from '../model/publishWarnings';

export interface PublishWarningsListProps {
  blocking: PublishWarningItem[];
  nonBlocking: PublishWarningItem[];
}

export const PublishWarningsList: React.FC<PublishWarningsListProps> = ({ blocking, nonBlocking }) => {
  if (blocking.length === 0 && nonBlocking.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No hay alertas. Podés continuar cuando quieras.
      </Typography>
    );
  }

  return (
    <List dense disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {blocking.map(w => (
        <ListItem key={w.id} sx={{ display: 'block', py: 0 }}>
          <Alert severity="error" variant="outlined" sx={{ py: 0.5 }}>
            <Typography variant="body2">{w.message}</Typography>
          </Alert>
        </ListItem>
      ))}
      {nonBlocking.map(w => (
        <ListItem key={w.id} sx={{ display: 'block', py: 0 }}>
          <Alert severity="warning" variant="outlined" sx={{ py: 0.5 }}>
            <Typography variant="body2">{w.message}</Typography>
          </Alert>
        </ListItem>
      ))}
    </List>
  );
};
