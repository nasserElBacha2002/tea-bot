import React, { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ConversationDetailResponse } from '../types/conversation.types';
import { handoffStatusLabel } from '../utils/conversationUiLabels';

interface Props {
  detail: ConversationDetailResponse;
}

export const ConversationTechnicalDetails: React.FC<Props> = ({ detail }) => {
  const [expanded, setExpanded] = useState(false);
  const { conversation, activeSession, humanHandoff } = detail;

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, v) => setExpanded(v)}
      disableGutters
      elevation={0}
      sx={{
        '&:before': { display: 'none' },
        bgcolor: 'transparent',
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40 }}>
        <Typography variant="body2" fontWeight={600} color="text.secondary">
          Detalles técnicos
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Stack spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            <strong>ID conversación:</strong> {conversation.id}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            <strong>Flujo:</strong> {conversation.currentFlowId ?? '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            <strong>Versión:</strong> {conversation.currentFlowVersion ?? '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            <strong>Nodo actual:</strong> {conversation.currentNodeKey ?? '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            <strong>Agente asignado:</strong> {conversation.assignedAgentId ?? '—'}
          </Typography>
          {humanHandoff && (
            <>
              <Typography variant="caption" color="text.secondary">
                <strong>Estado de atención:</strong> {handoffStatusLabel(humanHandoff.status)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                <strong>Motivo (raw):</strong> {humanHandoff.reason ?? '—'}
              </Typography>
            </>
          )}
          {activeSession && (
            <Typography variant="caption" color="text.secondary">
              <strong>Sesión:</strong> {activeSession.status} · {activeSession.flowId} (
              {activeSession.flowVersion ?? 'sin versión'}) · nodo {activeSession.currentNodeKey ?? '—'}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            <strong>Inicio:</strong> {conversation.startedAt}
          </Typography>
          {conversation.closedAt && (
            <Typography variant="caption" color="text.secondary">
              <strong>Cierre:</strong> {conversation.closedAt}
            </Typography>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
};
