import React, { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from '@mui/material';

export interface PublishConfirmDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

const PublishConfirmDialogBody: React.FC<
  Omit<PublishConfirmDialogProps, 'open'>
> = ({ loading, error, onClose, onConfirm }) => {
  const [ack, setAck] = useState(false);

  return (
    <>
      <DialogTitle>Confirmar publicación</DialogTitle>
      <DialogContent>
        <Typography variant="body1" sx={{ mb: 2 }}>
          ¿Confirmás que querés poner esta versión en vivo?
        </Typography>
        <FormControlLabel
          control={<Checkbox checked={ack} onChange={e => setAck(e.target.checked)} disabled={loading} />}
          label="He revisado el resumen y las alertas."
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
        <Button variant="contained" disabled={!ack || loading} onClick={() => void onConfirm()}>
          {loading ? 'Publicando…' : 'Sí, poner en vivo'}
        </Button>
      </DialogActions>
    </>
  );
};

export const PublishConfirmDialog: React.FC<PublishConfirmDialogProps> = ({
  open,
  loading,
  error,
  onClose,
  onConfirm,
}) => {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      {open ? (
        <PublishConfirmDialogBody loading={loading} error={error} onClose={onClose} onConfirm={onConfirm} />
      ) : null}
    </Dialog>
  );
};
