import React, { useState } from 'react';
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { MoreVert } from '@mui/icons-material';
import type { ConversationStep } from '../model/conversationViewModel';
import type { ConversationValidationIssue } from '../model/conversationValidation';
import { issuesForResponse, issuesForStep } from '../model/conversationValidation';
import { EmptyResponsesState } from './EmptyResponsesState';
import { AddResponseMenu } from './AddResponseMenu';
import { ResponseRow } from './ResponseRow';

export interface StepCardProps {
  step: ConversationStep;
  stepIndex: number;
  totalSteps: number;
  allSteps: ConversationStep[];
  validationIssues: ConversationValidationIssue[];
  active: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  onTitleChange: (title: string) => void;
  onMessageChange: (message: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddResponse: (kind: import('../model/conversationViewModel').ConversationResponseKind) => void;
  onUpdateResponseValues: (responseUiId: string, values: string[]) => void;
  onDeleteResponse: (responseUiId: string) => void;
  onSetResponseDestination: (responseUiId: string, targetId: string) => void;
  onCreateStepForResponse: (responseUiId: string) => void;
}

export const StepCard: React.FC<StepCardProps> = ({
  step,
  stepIndex,
  totalSteps,
  allSteps,
  validationIssues,
  active,
  cardRef,
  onTitleChange,
  onMessageChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onAddResponse,
  onUpdateResponseValues,
  onDeleteResponse,
  onSetResponseDestination,
  onCreateStepForResponse,
}) => {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(menuAnchor);

  const stepIssues = issuesForStep(step.internalId, validationIssues);
  const messageIssue = stepIssues.find(i => i.code === 'STEP_MESSAGE_EMPTY');
  const needsResponseIssue = stepIssues.find(i => i.code === 'STEP_NEEDS_RESPONSE');

  const hasFallback = step.responses.some(r => r.kind === 'fallback');

  const handleDeleteStep = () => {
    setMenuAnchor(null);
    if (totalSteps <= 1) return;
    if (window.confirm('¿Eliminar este paso? Las referencias a él se actualizarán automáticamente.')) {
      onDelete();
    }
  };

  return (
    <Paper
      id={`step-card-${step.internalId}`}
      ref={cardRef}
      elevation={0}
      sx={{
        mb: 2,
        p: 2,
        border: '1px solid',
        borderColor: active ? 'primary.main' : 'divider',
        borderRadius: 2,
        scrollMarginTop: 16,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2 }}>
        <TextField
          size="small"
          fullWidth
          label="Nombre del paso"
          value={step.title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="Solo para ti, para orientarte"
        />
        <IconButton aria-label="Menú del paso" onClick={e => setMenuAnchor(e.currentTarget)} size="small">
          <MoreVert />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={menuOpen} onClose={() => setMenuAnchor(null)}>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onDuplicate();
            }}
          >
            Duplicar paso
          </MenuItem>
          <MenuItem
            disabled={stepIndex <= 0}
            onClick={() => {
              setMenuAnchor(null);
              onMoveUp();
            }}
          >
            Subir
          </MenuItem>
          <MenuItem
            disabled={stepIndex >= totalSteps - 1}
            onClick={() => {
              setMenuAnchor(null);
              onMoveDown();
            }}
          >
            Bajar
          </MenuItem>
          <MenuItem
            disabled={totalSteps <= 1}
            onClick={handleDeleteStep}
            sx={{ color: 'error.main' }}
          >
            Eliminar paso
          </MenuItem>
        </Menu>
      </Box>

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
        Mensaje del bot
      </Typography>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={3}
        value={step.message}
        onChange={e => onMessageChange(e.target.value)}
        error={Boolean(messageIssue)}
        helperText={messageIssue?.message}
        placeholder="Lo que leerá el cliente en este paso"
        sx={{ mb: 2 }}
      />

      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Cuando el cliente responde
      </Typography>

      {needsResponseIssue && (
        <Typography variant="caption" color="error" display="block" sx={{ mb: 1 }}>
          {needsResponseIssue.message}
        </Typography>
      )}

      {step.responses.length === 0 ? (
        <EmptyResponsesState />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {step.responses.map(r => {
            const respIssues = issuesForResponse(step.internalId, r.uiId, validationIssues);
            const destIssues = respIssues.filter(
              i => i.code === 'RESPONSE_DESTINATION_MISSING' || i.code === 'RESPONSE_DESTINATION_UNKNOWN'
            );
            const valueIssues = respIssues.filter(
              i => i.code === 'RESPONSE_EXACT_EMPTY' || i.code === 'RESPONSE_ANYOF_EMPTY'
            );
            const multiFb = respIssues.filter(i => i.code === 'MULTIPLE_FALLBACK');
            return (
              <ResponseRow
                key={r.uiId}
                stepInternalId={step.internalId}
                response={r}
                allSteps={allSteps}
                rowIssues={multiFb.map(i => ({ message: i.message }))}
                destIssues={destIssues.map(i => ({ message: i.message }))}
                valueIssues={valueIssues.map(i => ({ message: i.message }))}
                onUpdateValues={vals => onUpdateResponseValues(r.uiId, vals)}
                onDelete={() => onDeleteResponse(r.uiId)}
                onDestinationChange={tid => onSetResponseDestination(r.uiId, tid)}
                onCreateDestination={() => onCreateStepForResponse(r.uiId)}
              />
            );
          })}
        </Box>
      )}

      <Box sx={{ mt: 2 }}>
        <AddResponseMenu hasFallback={hasFallback} onSelect={onAddResponse} />
      </Box>
    </Paper>
  );
};
