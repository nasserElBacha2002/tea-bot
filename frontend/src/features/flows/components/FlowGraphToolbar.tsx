import React from 'react';
import { Panel, useReactFlow } from '@xyflow/react';
import {
  Paper,
  Stack,
  IconButton,
  Tooltip,
  Divider,
  Button,
  Typography,
} from '@mui/material';
import {
  FitScreen,
  CenterFocusStrong,
  AccountTree,
  Message,
  FilterCenterFocus,
  CallSplit,
  StopCircle,
} from '@mui/icons-material';
import type { FlowNodeDataType } from '../types/flow.types';
import { UI_NODE_TYPE } from '../utils/flowUiLabels';

interface FlowGraphToolbarProps {
  selectedNodeId: string | null;
  onQuickAdd: (type: FlowNodeDataType) => void;
  onOrganize: () => void;
}

export const FlowGraphToolbar: React.FC<FlowGraphToolbarProps> = ({
  selectedNodeId,
  onQuickAdd,
  onOrganize,
}) => {
  const { fitView, setCenter, getZoom, getNode } = useReactFlow();

  const handleCenterSelected = () => {
    if (!selectedNodeId) return;
    const n = getNode(selectedNodeId);
    if (!n) return;
    const w = n.measured?.width ?? 220;
    const h = n.measured?.height ?? 100;
    const x = n.position.x + w / 2;
    const y = n.position.y + h / 2;
    const z = Math.max(getZoom(), 0.85);
    setCenter(x, y, { zoom: z, duration: 280 });
  };

  return (
    <Panel position="top-left">
      <Paper
        elevation={2}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          p: 1,
          maxWidth: 320,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          Lienzo
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={0.25} alignItems="center">
          <Tooltip title="Encajar todos los nodos">
            <IconButton size="small" onClick={() => fitView({ padding: 0.2, duration: 320 })} color="primary">
              <FitScreen fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Centrar en el nodo seleccionado">
            <span>
              <IconButton size="small" onClick={handleCenterSelected} disabled={!selectedNodeId}>
                <CenterFocusStrong fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Diseño automático (capas desde la entrada)">
            <IconButton size="small" onClick={onOrganize} color="secondary">
              <AccountTree fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Divider flexItem />
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          Añadir rápido
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          <Button size="small" variant="outlined" startIcon={<Message />} onClick={() => onQuickAdd('message')}>
            {UI_NODE_TYPE.message}
          </Button>
          <Button size="small" variant="outlined" startIcon={<FilterCenterFocus />} onClick={() => onQuickAdd('capture')}>
            {UI_NODE_TYPE.capture}
          </Button>
          <Button size="small" variant="outlined" startIcon={<CallSplit />} onClick={() => onQuickAdd('redirect')}>
            {UI_NODE_TYPE.redirect}
          </Button>
          <Button size="small" variant="outlined" startIcon={<StopCircle />} onClick={() => onQuickAdd('end')}>
            {UI_NODE_TYPE.end}
          </Button>
        </Stack>
      </Paper>
    </Panel>
  );
};
