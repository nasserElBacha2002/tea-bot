import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Close, CenterFocusStrong, ZoomOutMap } from '@mui/icons-material';
import type { Flow } from '../../types/flow.types';
import { FlowGraphCanvas } from '../../components/FlowGraphCanvas';
import {
  collectNodesWithinDepth,
  filterFlowToNodes,
  resolveMapFocusNodeId,
  searchFlowNodes,
  type MapDepthOption,
} from '../../utils/flowMapSubgraph';

export interface AdvancedMapViewProps {
  open: boolean;
  flow: Flow;
  focusNodeId: string | null;
  onClose: () => void;
  onNodeSelect?: (nodeId: string) => void;
}

const DEPTH_OPTIONS: { value: MapDepthOption; label: string }[] = [
  { value: 1, label: '1 salto' },
  { value: 2, label: '2 saltos' },
  { value: 3, label: '3 saltos' },
  { value: 'all', label: 'Todo el flujo' },
];

const LEGEND = [
  { color: '#2563eb', label: 'Mensaje' },
  { color: '#dc2626', label: 'Cierre / fin' },
  { color: '#ea580c', label: 'Nodo seleccionado' },
  { color: '#94a3b8', label: 'Conexión' },
];

export const AdvancedMapView: React.FC<AdvancedMapViewProps> = ({
  open,
  flow,
  focusNodeId,
  onClose,
  onNodeSelect,
}) => {
  const [depth, setDepth] = useState<MapDepthOption>(2);
  const [mapFocusId, setMapFocusId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPick, setSearchPick] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (open) {
      setMapFocusId(resolveMapFocusNodeId(flow, focusNodeId));
      setDepth(2);
      setSearchQuery('');
      setSearchPick(null);
    }
  }, [open, flow, focusNodeId]);

  const visibleFlow = useMemo(() => {
    const focus = mapFocusId || resolveMapFocusNodeId(flow, focusNodeId);
    const ids = collectNodesWithinDepth(flow, focus, depth);
    return filterFlowToNodes(flow, ids);
  }, [flow, mapFocusId, focusNodeId, depth]);

  const searchOptions = useMemo(() => searchFlowNodes(flow, searchQuery), [flow, searchQuery]);

  const handleSearchSelect = useCallback(
    (id: string | null) => {
      if (!id) return;
      setMapFocusId(id);
      setSearchPick({ id, title: id });
      onNodeSelect?.(id);
    },
    [onNodeSelect],
  );

  const noopFlow = useCallback((f: Flow) => {
    void f;
  }, []);

  return (
    <Dialog fullScreen open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: 'background.default' } }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          <IconButton edge="start" onClick={onClose} aria-label="Cerrar mapa" size="small">
            <Close />
          </IconButton>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mr: 1 }}>
            Mapa de lectura
          </Typography>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="map-depth-label">Profundidad</InputLabel>
            <Select
              labelId="map-depth-label"
              label="Profundidad"
              value={depth}
              onChange={(e) => setDepth(e.target.value as MapDepthOption)}
            >
              {DEPTH_OPTIONS.map((o) => (
                <MenuItem key={String(o.value)} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Autocomplete
            size="small"
            sx={{ minWidth: 220, flex: { xs: '1 1 100%', sm: '1 1 280px' }, maxWidth: 400 }}
            options={searchOptions}
            getOptionLabel={(o) => `${o.title} (${o.id})`}
            inputValue={searchQuery}
            onInputChange={(_, v) => setSearchQuery(v)}
            onChange={(_, opt) => handleSearchSelect(opt?.id ?? null)}
            value={searchOptions.find((o) => o.id === searchPick?.id) ?? null}
            renderInput={(params) => (
              <TextField {...params} label="Buscar paso" placeholder="nombre, id o mensaje" />
            )}
          />

          <Button
            size="small"
            variant="outlined"
            startIcon={<CenterFocusStrong />}
            onClick={() => setMapFocusId(resolveMapFocusNodeId(flow, focusNodeId))}
          >
            Centrar nodo actual
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={<ZoomOutMap />}
            onClick={() => setDepth('all')}
          >
            Ver flujo completo
          </Button>

          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', ml: { md: 'auto' } }}>
            {LEGEND.map((item) => (
              <Chip
                key={item.label}
                size="small"
                label={item.label}
                sx={{
                  bgcolor: `${item.color}18`,
                  borderColor: item.color,
                  border: '1px solid',
                  fontSize: 10,
                }}
              />
            ))}
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5 }}>
          Solo lectura. Mostrando {visibleFlow.nodes.length} pasos
          {depth !== 'all' ? ` (profundidad: ${depth === 1 ? '1 salto' : `${depth} saltos`})` : ''}.
          Hacé clic en un nodo para ir al paso en el editor.
        </Typography>

        <Box sx={{ flex: 1, minHeight: 0 }}>
          <FlowGraphCanvas
            flow={visibleFlow}
            selectedNodeId={mapFocusId}
            selectedEdge={null}
            onNodeSelect={setMapFocusId}
            onEdgeSelect={() => {}}
            onFlowChange={noopFlow}
            onQuickAddNode={() => {}}
            onOrganizeLayout={() => {}}
            readOnly
            mapViewMode
            initialFocusNodeId={mapFocusId}
            onMapNodeActivate={(id) => {
              setMapFocusId(id);
              onNodeSelect?.(id);
            }}
          />
        </Box>
      </Box>
    </Dialog>
  );
};
