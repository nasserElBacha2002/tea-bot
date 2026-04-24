import React from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import type { RestoreTarget } from '../state/useConversationHistory';

export interface RestoreDraftDialogProps {
  open: boolean;
  target: RestoreTarget | null;
  editorDirty: boolean;
  loading: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export const RestoreDraftDialog: React.FC<RestoreDraftDialogProps> = ({
  open,
  target,
  editorDirty,
  loading,
  errorMessage,
  onClose,
  onConfirm,
}) => {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Traer versión al borrador</DialogTitle>
      <DialogContent dividers>
        {target && (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Vas a reemplazar el <strong>borrador actual</strong> por la versión publicada{' '}
              <strong>{target.versionLabel}</strong> ({new Date(target.publishedAt).toLocaleString()}).
            </Typography>
            {editorDirty ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Tenés <strong>cambios sin guardar</strong> en esta pantalla. Al continuar, esos cambios locales
                se perderán y el borrador quedará igual que esa versión publicada.
              </Alert>
            ) : (
              <Alert severity="info" sx={{ mb: 2 }}>
                El borrador actual se reemplazará por el contenido de esa versión. Podés seguir editando después
                y guardar cuando quieras.
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary">
              Esta acción no borra el historial publicado: solo actualiza tu borrador de trabajo.
            </Typography>
          </>
        )}
        {errorMessage && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errorMessage}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          color={editorDirty ? 'warning' : 'primary'}
          onClick={() => void onConfirm()}
          disabled={loading || !target}
        >
          {loading ? <CircularProgress size={22} /> : 'Sí, traer al borrador'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
