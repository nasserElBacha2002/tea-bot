import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

export const MAP_INTRO_STORAGE_KEY = 'tea-conversation-map-intro-seen';

export interface AdvancedMapIntroDialogProps {
  open: boolean;
  onCancel: () => void;
  onContinue: () => void;
}

export const AdvancedMapIntroDialog: React.FC<AdvancedMapIntroDialogProps> = ({
  open,
  onCancel,
  onContinue,
}) => {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Mapa avanzado</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>
          El <strong>mapa</strong> es una vista visual de toda la conversación. Sirve para orientarte cuando el
          flujo es largo.
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          La mayoría de los cambios son más simples en la vista normal con tarjetas de pasos.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          En esta versión el mapa es solo de lectura: podés explorar, no editar desde aquí.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Volver</Button>
        <Button variant="contained" onClick={onContinue}>
          Entendido, abrir mapa
        </Button>
      </DialogActions>
    </Dialog>
  );
};
