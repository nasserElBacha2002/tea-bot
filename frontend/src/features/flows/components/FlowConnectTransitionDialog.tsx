import React, { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Typography,
  Stack,
} from '@mui/material';
import type { FlowTransition, FlowTransitionType } from '../types/flow.types';
import { UI_TRANSITION_TYPE } from '../utils/flowUiLabels';

export interface PendingConnection {
  source: string;
  target: string;
}

interface FormValues {
  type: FlowTransitionType;
  value: string;
  nextNode: string;
  priority: string;
}

interface FlowConnectTransitionDialogProps {
  open: boolean;
  pending: PendingConnection | null;
  nodeIds: string[];
  onClose: () => void;
  onConfirm: (t: FlowTransition) => void;
}

const TYPES: FlowTransitionType[] = ['match', 'matchAny', 'matchIncludes', 'default'];

export const FlowConnectTransitionDialog: React.FC<FlowConnectTransitionDialogProps> = ({
  open,
  pending,
  nodeIds,
  onClose,
  onConfirm,
}) => {
  const { control, handleSubmit, reset, watch } = useForm<FormValues>({
    defaultValues: {
      type: 'default',
      value: '',
      nextNode: '',
      priority: '',
    },
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- RHF watch para UI condicional del value field
  const type = watch('type');

  useEffect(() => {
    if (open && pending) {
      reset({
        type: 'default',
        value: '',
        nextNode: pending.target,
        priority: '',
      });
    }
  }, [open, pending, reset]);

  const submit = handleSubmit(values => {
    if (!pending) return;
    const nextNode = values.nextNode || pending.target;
    const trans: FlowTransition = {
      type: values.type,
      nextNode,
    };
    if (values.priority.trim() !== '' && !Number.isNaN(Number(values.priority))) {
      trans.priority = Number(values.priority);
    }
    if (values.type === 'matchAny') {
      trans.value = values.value.split(',').map(s => s.trim()).filter(Boolean);
    } else if (values.type !== 'default') {
      trans.value = values.value;
    }
    onConfirm(trans);
    onClose();
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Nueva transición</DialogTitle>
      <DialogContent>
        {pending && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Desde <strong>{pending.source}</strong> → configura la regla hacia <strong>{pending.target}</strong>
          </Typography>
        )}
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <FormControl size="small" fullWidth>
                <InputLabel>Tipo de regla</InputLabel>
                <Select {...field} label="Tipo de regla">
                  {TYPES.map(t => (
                    <MenuItem key={t} value={t}>
                      {UI_TRANSITION_TYPE[t]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />
          {type && type !== 'default' && (
            <Controller
              name="value"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  size="small"
                  fullWidth
                  label={type === 'matchAny' ? 'Valores (separados por coma)' : 'Valor'}
                  placeholder={type === 'matchAny' ? 'a, b, c' : 'texto'}
                />
              )}
            />
          )}
          <Controller
            name="nextNode"
            control={control}
            render={({ field }) => (
              <FormControl size="small" fullWidth>
                <InputLabel>Nodo destino</InputLabel>
                <Select {...field} label="Nodo destino">
                  {nodeIds.map(id => (
                    <MenuItem key={id} value={id}>
                      {id}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />
          <Controller
            name="priority"
            control={control}
            render={({ field }) => (
              <TextField {...field} size="small" label="Prioridad (opcional)" placeholder="0" fullWidth />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit}>
          Añadir transición
        </Button>
      </DialogActions>
    </Dialog>
  );
};
