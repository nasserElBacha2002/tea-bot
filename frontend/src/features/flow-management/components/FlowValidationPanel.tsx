import React from 'react';
import { Alert, AlertTitle, Box, List, ListItem, ListItemText, Typography } from '@mui/material';
import type { FlowValidationResult } from '../types/flowManagement.types';

export const FlowValidationPanel: React.FC<{
  result?: FlowValidationResult | null;
  loading?: boolean;
}> = ({ result, loading }) => {
  if (loading) return <Typography variant="body2">Validando…</Typography>;
  if (!result) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {result.valid ? (
        <Alert severity="success">El borrador es válido y puede publicarse.</Alert>
      ) : (
        <Alert severity="error">
          <AlertTitle>El borrador tiene errores y no puede publicarse.</AlertTitle>
        </Alert>
      )}
      {result.warnings.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>El borrador tiene advertencias.</AlertTitle>
          <List dense disablePadding>
            {result.warnings.map((w, i) => (
              <ListItem key={`w-${i}`} disableGutters>
                <ListItemText
                  primary={w.message}
                  secondary={w.nodeKey ? `Nodo: ${w.nodeKey}` : w.code}
                />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}
      {result.errors.length > 0 && (
        <List dense>
          {result.errors.map((e, i) => (
            <ListItem key={`e-${i}`} disableGutters>
              <ListItemText primary={e.message} secondary={e.nodeKey ? `Nodo: ${e.nodeKey}` : e.code} />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};
