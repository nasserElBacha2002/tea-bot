import React, { useCallback, useState } from 'react';
import { Box, Dialog, IconButton, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';
import type { Flow, GraphEdgeSelection } from '../../types/flow.types';
import { FlowGraphCanvas } from '../../components/FlowGraphCanvas';

export interface AdvancedMapViewProps {
  open: boolean;
  flow: Flow;
  onClose: () => void;
}

/**
 * Mapa (nivel 3): grafo sincronizado con el borrador actual, solo lectura.
 */
export const AdvancedMapView: React.FC<AdvancedMapViewProps> = ({ open, flow, onClose }) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeSelection | null>(null);

  const noopFlow = useCallback((flow: Flow) => {
    void flow;
    /* Solo lectura: no aplicamos cambios desde el mapa. */
  }, []);

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { bgcolor: 'background.default' } }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <IconButton edge="start" onClick={onClose} aria-label="Cerrar mapa" size="small">
          <Close />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={700}>
          Mapa (solo lectura)
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, height: 'calc(100% - 48px)' }}>
        <FlowGraphCanvas
          flow={flow}
          selectedNodeId={selectedNodeId}
          selectedEdge={selectedEdge}
          onNodeSelect={setSelectedNodeId}
          onEdgeSelect={setSelectedEdge}
          onFlowChange={noopFlow}
          onQuickAddNode={() => {}}
          onOrganizeLayout={() => {}}
          readOnly
        />
      </Box>
    </Dialog>
  );
};
