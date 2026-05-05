import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { Flow } from '../../types/flow.types';

export interface ImportJsonVersionDialogProps {
  open: boolean;
  loadingValidate: boolean;
  loadingCreate: boolean;
  onClose: () => void;
  onValidate: (flow: Partial<Flow>) => Promise<{ valid: boolean; error?: string }>;
  onCreate: (flow: Partial<Flow>, publish: boolean) => Promise<void>;
}

export const ImportJsonVersionDialog: React.FC<ImportJsonVersionDialogProps> = ({
  open,
  loadingValidate,
  loadingCreate,
  onClose,
  onValidate,
  onCreate,
}) => {
  const [rawJson, setRawJson] = useState('');
  const [publishAfterCreate, setPublishAfterCreate] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [parsedFlow, setParsedFlow] = useState<Partial<Flow> | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canRun = useMemo(() => rawJson.trim().length > 0 && !loadingValidate && !loadingCreate, [
    rawJson,
    loadingValidate,
    loadingCreate,
  ]);

  const resetMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const parseJson = (): Partial<Flow> | null => {
    try {
      const parsed = JSON.parse(rawJson) as Partial<Flow>;
      setParsedFlow(parsed);
      return parsed;
    } catch {
      setParsedFlow(null);
      setIsValid(false);
      setErrorMessage('El texto no es un JSON válido. Revisá comas, llaves y comillas.');
      return null;
    }
  };

  const handleFormat = () => {
    resetMessages();
    const parsed = parseJson();
    if (!parsed) return;
    setRawJson(JSON.stringify(parsed, null, 2));
  };

  const handleValidate = async () => {
    resetMessages();
    const parsed = parseJson();
    if (!parsed) return;
    try {
      const res = await onValidate(parsed);
      if (res.valid) {
        setIsValid(true);
        setSuccessMessage('JSON válido. Ya podés crear una nueva versión.');
        return;
      }
      setIsValid(false);
      setErrorMessage(res.error ?? 'El flujo no pasó la validación.');
    } catch (e) {
      setIsValid(false);
      setErrorMessage(e instanceof Error ? e.message : 'No se pudo validar el JSON.');
    }
  };

  const handleCreate = async () => {
    if (!parsedFlow || !isValid) return;
    resetMessages();
    try {
      await onCreate(parsedFlow, publishAfterCreate);
      setSuccessMessage('Nueva versión creada correctamente.');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'No se pudo crear la nueva versión.');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={loadingCreate ? undefined : onClose} maxWidth="md" fullWidth>
        <DialogTitle>Importar JSON como nueva versión</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Pegá un JSON completo del flujo. Se validará antes de crear la nueva versión.
            </Typography>
            <TextField
              label="JSON del flujo"
              multiline
              minRows={14}
              maxRows={20}
              value={rawJson}
              onChange={e => {
                setRawJson(e.target.value);
                setIsValid(false);
                setParsedFlow(null);
                resetMessages();
              }}
              placeholder='{"id":"main-menu","entryNode":"start","nodes":[]}'
              fullWidth
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={publishAfterCreate}
                  onChange={e => setPublishAfterCreate(e.target.checked)}
                />
              }
              label="Publicar automáticamente esta versión al crearla"
            />
            <Typography variant="caption" color="text.secondary">
              Si no marcás esta opción, solo se creará la nueva versión y no se activará en vivo.
            </Typography>
            {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
            {successMessage && <Alert severity="success">{successMessage}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={handleFormat} disabled={!canRun}>
              Formatear JSON
            </Button>
            <Button variant="outlined" onClick={() => void handleValidate()} disabled={!canRun}>
              {loadingValidate ? <CircularProgress size={20} /> : 'Validar JSON'}
            </Button>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button onClick={onClose} disabled={loadingCreate}>
              Cancelar
            </Button>
            <Button
              variant="contained"
              color="primary"
              disabled={!isValid || loadingCreate}
              onClick={() => setConfirmOpen(true)}
            >
              {loadingCreate ? <CircularProgress size={20} /> : 'Crear nueva versión'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={loadingCreate ? undefined : () => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirmar creación de versión</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Se creará una nueva versión del flujo. No se modificarán versiones anteriores.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={loadingCreate}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              setConfirmOpen(false);
              await handleCreate();
            }}
            disabled={loadingCreate}
          >
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
