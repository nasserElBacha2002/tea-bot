import React from 'react';
import { Alert, AlertTitle, Button } from '@mui/material';
import { extractApiError } from '../../../utils/apiError';

interface Props {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}

export const ConversationPersistenceAlert: React.FC<Props> = ({
  error,
  onRetry,
  retrying,
}) => {
  const { message } = extractApiError(error);

  return (
    <Alert
      severity="error"
      sx={{ m: 2, mb: 0 }}
      action={
        <Button color="inherit" size="small" onClick={onRetry} disabled={retrying}>
          Reintentar
        </Button>
      }
    >
      <AlertTitle>No se pudo cargar la bandeja</AlertTitle>
      {message}
    </Alert>
  );
};
