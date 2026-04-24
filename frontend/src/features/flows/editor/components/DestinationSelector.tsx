import React from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import type { ConversationStep } from '../model/conversationViewModel';

export const CREATE_NEW_STEP_VALUE = '__CREATE_NEW_STEP__';

export interface DestinationSelectorProps {
  steps: ConversationStep[];
  value: string;
  currentStepId: string;
  label?: string;
  error?: boolean;
  helperText?: string;
  onChange: (targetStepId: string) => void;
  onCreateNew: () => void;
}

export const DestinationSelector: React.FC<DestinationSelectorProps> = ({
  steps,
  value,
  currentStepId,
  label = 'Luego ir a',
  error,
  helperText,
  onChange,
  onCreateNew,
}) => {
  const handle = (v: string) => {
    if (v === CREATE_NEW_STEP_VALUE) {
      onCreateNew();
      return;
    }
    onChange(v);
  };

  const loop = value === currentStepId;

  return (
    <Box sx={{ minWidth: 200, flex: 1 }}>
      <FormControl size="small" fullWidth error={error}>
        <InputLabel id={`dest-${currentStepId}`}>{label}</InputLabel>
        <Select
          labelId={`dest-${currentStepId}`}
          label={label}
          value={value || ''}
          onChange={e => handle(e.target.value as string)}
        >
          {steps.map(s => (
            <MenuItem key={s.internalId} value={s.internalId}>
              {s.title}
            </MenuItem>
          ))}
          <MenuItem value={CREATE_NEW_STEP_VALUE} sx={{ fontWeight: 700, color: 'primary.main' }}>
            + Crear paso nuevo
          </MenuItem>
        </Select>
      </FormControl>
      {helperText && (
        <Typography variant="caption" color={error ? 'error' : 'text.secondary'} display="block" sx={{ mt: 0.5 }}>
          {helperText}
        </Typography>
      )}
      {loop && (
        <Typography variant="caption" color="warning.dark" display="block" sx={{ mt: 0.5, fontWeight: 600 }}>
          El cliente volverá a este mismo paso.
        </Typography>
      )}
    </Box>
  );
};
