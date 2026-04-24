import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';

export interface FlowMetadataDialogProps {
  open: boolean;
  initialName: string;
  initialDescription: string;
  onClose: () => void;
  onSave: (flowName: string, description: string) => void;
}

/** Contenido del diálogo: montaje solo cuando `open` para sincronizar estado con props iniciales. */
function FlowMetadataFormInner({
  initialName,
  initialDescription,
  onCancel,
  onSave,
}: {
  initialName: string;
  initialDescription: string;
  onCancel: () => void;
  onSave: (flowName: string, description: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  return (
    <>
      <DialogTitle>Datos de la conversación</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          El nombre se muestra en el listado y en la barra superior. La descripción es opcional.
        </Typography>
        <TextField
          label="Nombre"
          value={name}
          onChange={e => setName(e.target.value)}
          fullWidth
          size="small"
          required
        />
        <TextField
          label="Descripción (opcional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          fullWidth
          size="small"
          multiline
          minRows={2}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          variant="contained"
          onClick={() => {
            onSave(name, description);
            onCancel();
          }}
          disabled={!name.trim()}
        >
          Aplicar
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * Edición de nombre y descripción del flujo (metadatos a nivel conversación).
 */
export const FlowMetadataDialog: React.FC<FlowMetadataDialogProps> = ({
  open,
  initialName,
  initialDescription,
  onClose,
  onSave,
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      {open ? (
        <FlowMetadataFormInner
          key={`${initialName}\0${initialDescription}`}
          initialName={initialName}
          initialDescription={initialDescription}
          onCancel={onClose}
          onSave={onSave}
        />
      ) : null}
    </Dialog>
  );
};
