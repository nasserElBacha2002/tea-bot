import React from 'react';
import {
  Box,
  Divider,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import { Close } from '@mui/icons-material';
import type { Flow, FlowNode } from '../../types/flow.types';
import { getNodeIssues } from '../../utils/flowGraph.validation';
import {
  formatTransitionDetail,
  getNodeDisplayTitle,
  groupTransitionsByTarget,
  nodeTypeLabel,
  prepareMessageForPreview,
} from '../../utils/flowMapDisplay';

export interface MapNodeDetailPanelProps {
  flow: Flow;
  nodeId: string | null;
  onClose: () => void;
}

export const MapNodeDetailPanel: React.FC<MapNodeDetailPanelProps> = ({
  flow,
  nodeId,
  onClose,
}) => {
  const node: FlowNode | undefined = nodeId
    ? flow.nodes.find((n) => n.id === nodeId)
    : undefined;

  if (!node) {
    return (
      <Paper
        elevation={0}
        sx={{
          width: 320,
          flexShrink: 0,
          borderLeft: '1px solid',
          borderColor: 'divider',
          p: 2,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Seleccioná un paso en el mapa para ver el detalle completo.
        </Typography>
      </Paper>
    );
  }

  const issues = getNodeIssues(flow, node);
  const groups = groupTransitionsByTarget(node, flow);
  const fullMessage = prepareMessageForPreview(node.message ?? '');

  return (
    <Paper
      elevation={0}
      sx={{
        width: { xs: '100%', md: 320 },
        maxWidth: 360,
        flexShrink: 0,
        borderLeft: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        maxHeight: { xs: 240, md: 'none' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle2" fontWeight={700}>
          Detalle del paso
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="Cerrar detalle">
          <Close fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1.5 }}>
        <Typography variant="body2" fontWeight={700}>
          {getNodeDisplayTitle(node)}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          ID: {node.id} · {nodeTypeLabel(node.type)}
        </Typography>

        {node.id === flow.entryNode && (
          <Typography variant="caption" color="success.main" display="block">
            Entrada del flujo
          </Typography>
        )}
        {node.id === flow.fallbackNode && (
          <Typography variant="caption" color="warning.main" display="block">
            Nodo de respaldo
          </Typography>
        )}

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="caption" fontWeight={700} color="text.secondary">
          Mensaje completo
        </Typography>
        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-wrap',
            mt: 0.5,
            mb: 1.5,
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {fullMessage || '(Sin mensaje)'}
        </Typography>

        {groups.length > 0 && (
          <>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Transiciones
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.25, mt: 0.5 }}>
              {groups.flatMap((g) =>
                g.transitions.map((t, i) => (
                  <Typography
                    key={`${g.target}-${i}`}
                    component="li"
                    variant="caption"
                    sx={{ mb: 0.35 }}
                  >
                    {formatTransitionDetail(t, i)} ({g.targetTitle})
                  </Typography>
                )),
              )}
            </Box>
          </>
        )}

        {node.type === 'capture' && node.variableName && (
          <Typography variant="caption" display="block" sx={{ mt: 1 }}>
            Variable: {node.variableName}
          </Typography>
        )}

        {issues.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" fontWeight={700} color="error.main">
              Validación
            </Typography>
            {issues.map((issue) => (
              <Typography key={issue.code} variant="caption" display="block" color="text.secondary">
                • {issue.message}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    </Paper>
  );
};
