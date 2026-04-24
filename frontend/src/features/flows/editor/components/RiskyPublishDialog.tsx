import React, { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import type { PublishWarningItem } from '../model/publishWarnings';

export const RISKY_PUBLISH_CONFIRM_TEXT = 'PUBLICAR';

export interface RiskyPublishDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  blockingWarnings: PublishWarningItem[];
  onClose: () => void;
  onConfirm: () => void;
}

const RiskyPublishDialogBody: React.FC<Omit<RiskyPublishDialogProps, 'open'>> = ({
  loading,
  error,
  blockingWarnings,
  onClose,
  onConfirm,
}) => {
  const [typed, setTyped] = useState('');
  const canSubmit = typed === RISKY_PUBLISH_CONFIRM_TEXT && !loading;

  return (
    <>
      <DialogTitle>Publicar con problemas pendientes</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Estos temas pueden afectar a los clientes. Solo publicá si entendés el riesgo.
        </Typography>
        {blockingWarnings.map(w => (
          <Alert key={w.id} severity="error" variant="outlined" sx={{ mb: 1 }}>
            {w.message}
          </Alert>
        ))}
        <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>
          Para confirmar, escribí exactamente: <strong>{RISKY_PUBLISH_CONFIRM_TEXT}</strong>
        </Typography>
        <TextField
          fullWidth
          size="small"
          value={typed}
          onChange={e => setTyped(e.target.value)}
          disabled={loading}
          autoComplete="off"
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading} color="inherit">
          Cancelar
        </Button>
        <Button variant="contained" color="warning" disabled={!canSubmit} onClick={() => void onConfirm()}>
          {loading ? 'Publicando…' : 'Sí, poner en vivo igualmente'}
        </Button>
      </DialogActions>
    </>
  );
};

export const RiskyPublishDialog: React.FC<RiskyPublishDialogProps> = ({
  open,
  loading,
  error,
  blockingWarnings,
  onClose,
  onConfirm,
}) => {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      {open ? (
        <RiskyPublishDialogBody
          loading={loading}
          error={error}
          blockingWarnings={blockingWarnings}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  );
};
