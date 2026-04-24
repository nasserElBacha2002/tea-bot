import React from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { RestartAlt } from '@mui/icons-material';
import type { Flow } from '../../types/flow.types';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { useConversationSimulator } from '../state/useConversationSimulator';
import { SimulatorChat } from './SimulatorChat';
import { SimulatorDetailsAccordion } from './SimulatorDetailsAccordion';

export interface SimulatorPanelProps {
  variant: 'panel' | 'modal';
  flowId: string;
  draftFlow: Flow;
  viewModel: ConversationViewModel;
}

export const SimulatorPanel: React.FC<SimulatorPanelProps> = ({ variant, flowId, draftFlow, viewModel }) => {
  const sim = useConversationSimulator({ flowId, draftFlow, viewModel });

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: variant === 'panel' ? 280 : 0,
        flex: variant === 'modal' ? 1 : undefined,
        height: variant === 'panel' ? '100%' : undefined,
        maxHeight: variant === 'panel' ? '100%' : undefined,
        p: 1.5,
        bgcolor: 'grey.50',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: variant === 'modal' ? 'flex-end' : 'space-between',
          alignItems: 'center',
          gap: 1,
          mb: 1,
          flexShrink: 0,
        }}
      >
        {variant === 'panel' && (
          <Typography variant="subtitle2" fontWeight={700}>
            Probar conversación
          </Typography>
        )}
        <Button
          size="small"
          startIcon={<RestartAlt />}
          onClick={() => void sim.restart()}
          color="inherit"
          disabled={sim.loading || sim.sending}
        >
          Reiniciar prueba
        </Button>
      </Box>

      {sim.draftOutOfSync && (
        <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
          <Typography variant="caption">Reiniciá la prueba para aplicar los últimos cambios del borrador.</Typography>
        </Alert>
      )}

      {sim.loading && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {!sim.loading && sim.error && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, py: 2 }}>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {sim.error}
          </Typography>
          <Button variant="outlined" size="small" onClick={() => void sim.retry()}>
            Reintentar
          </Button>
        </Box>
      )}

      {!sim.loading && !sim.error && (
        <>
          <SimulatorChat
            messages={sim.messages}
            loading={sim.loading}
            started={sim.started}
            sending={sim.sending}
            onSend={text => void sim.sendMessage(text)}
            showEmptyHint={sim.messages.length === 0}
          />
          <Box sx={{ mt: 1, flexShrink: 0 }}>
            <SimulatorDetailsAccordion currentStepTitle={sim.currentStepTitle} variables={sim.variables} />
          </Box>
        </>
      )}
    </Box>
  );
};
