import React from 'react';
import { Box, IconButton, TextField, Typography } from '@mui/material';
import { DeleteOutline } from '@mui/icons-material';
import type { ConversationResponse } from '../model/conversationViewModel';
import type { ConversationStep } from '../model/conversationViewModel';
import { DestinationSelector } from './DestinationSelector';

export interface ResponseRowProps {
  stepInternalId: string;
  response: ConversationResponse;
  allSteps: ConversationStep[];
  rowIssues: { message: string }[];
  destIssues: { message: string }[];
  valueIssues: { message: string }[];
  onUpdateValues: (values: string[]) => void;
  onDelete: () => void;
  onDestinationChange: (targetId: string) => void;
  onCreateDestination: () => void;
}

export const ResponseRow: React.FC<ResponseRowProps> = ({
  stepInternalId,
  response,
  allSteps,
  rowIssues,
  destIssues,
  valueIssues,
  onUpdateValues,
  onDelete,
  onDestinationChange,
  onCreateDestination,
}) => {
  const destError = destIssues.length > 0;
  const valueError = valueIssues.length > 0;
  const rowError = rowIssues.length > 0;

  const labelForKind =
    response.kind === 'exact'
      ? 'Solo si dice exactamente…'
      : response.kind === 'anyOf'
        ? 'Si dice cualquiera de estas cosas… (separar con coma)'
        : 'En cualquier otro caso';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 1.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: rowError || valueError || destError ? 'error.main' : 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          {labelForKind}
        </Typography>
        <IconButton size="small" onClick={onDelete} aria-label="Eliminar respuesta" color="error">
          <DeleteOutline fontSize="small" />
        </IconButton>
      </Box>

      {response.kind === 'exact' && (
        <TextField
          size="small"
          fullWidth
          value={response.values[0] ?? ''}
          onChange={e => onUpdateValues([e.target.value])}
          error={valueError}
          helperText={valueIssues[0]?.message}
          placeholder="Ej.: Sí"
        />
      )}

      {response.kind === 'anyOf' && (
        <TextField
          size="small"
          fullWidth
          value={response.values.join(', ')}
          onChange={e =>
            onUpdateValues(
              e.target.value
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
            )
          }
          error={valueError}
          helperText={valueIssues[0]?.message ?? 'Ej.: sí, ok, dale'}
        />
      )}

      {response.kind === 'fallback' && (
        <Typography variant="body2" color="text.secondary">
          Cubre todas las respuestas que no coincidan con las filas de arriba.
        </Typography>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1 }}>
        <DestinationSelector
          steps={allSteps}
          value={response.destinationStepId}
          currentStepId={stepInternalId}
          error={destError}
          helperText={destIssues[0]?.message}
          onChange={onDestinationChange}
          onCreateNew={onCreateDestination}
        />
      </Box>

      {rowIssues.map((iss, i) => (
        <Typography key={i} variant="caption" color="error" display="block">
          {iss.message}
        </Typography>
      ))}
    </Box>
  );
};
