import React, { useState } from 'react';
import { Box, Button, Divider, Stack, Tab, Tabs, Typography } from '@mui/material';
import {
  CheckCircle,
  Download,
  EditNote,
  Map,
} from '@mui/icons-material';
import type { Flow } from '../../types/flow.types';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { ConnectionsTable } from './ConnectionsTable';
import { HistoryTimeline } from './HistoryTimeline';
import { AdvancedMapIntroDialog, MAP_INTRO_STORAGE_KEY } from './AdvancedMapIntroDialog';
import { AdvancedMapView } from './AdvancedMapView';
import type { ConnectionRow } from '../model/connectionRows';

export type MoreToolsTabValue = 'connections' | 'history' | 'map';

export interface MoreToolsPanelProps {
  flowId: string;
  viewModel: ConversationViewModel;
  draftFlow: Flow;
  editorDirty: boolean;
  focusNodeId: string | null;
  compactToolbar?: boolean;
  onRestoreSuccess: () => void | Promise<void>;
  onConnectionRowActivate?: (row: ConnectionRow) => void;
  onValidateWithoutSave?: () => void;
  onOpenMetadata?: () => void;
  onDownloadJson?: () => void;
  onImportJson?: () => void;
  onMapNodeSelect?: (nodeId: string) => void;
  validatePending?: boolean;
  downloadPending?: boolean;
}

export const MoreToolsPanel: React.FC<MoreToolsPanelProps> = ({
  flowId,
  viewModel,
  draftFlow,
  editorDirty,
  focusNodeId,
  compactToolbar = false,
  onRestoreSuccess,
  onConnectionRowActivate,
  onValidateWithoutSave,
  onOpenMetadata,
  onDownloadJson,
  onImportJson,
  onMapNodeSelect,
  validatePending = false,
  downloadPending = false,
}) => {
  const [tab, setTab] = useState<MoreToolsTabValue>('connections');
  const [introOpen, setIntroOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState<Record<MoreToolsTabValue, boolean>>({
    connections: true,
    history: false,
    map: false,
  });

  const openMapFlow = () => {
    try {
      if (typeof localStorage !== 'undefined' && !localStorage.getItem(MAP_INTRO_STORAGE_KEY)) {
        setIntroOpen(true);
        return;
      }
    } catch {
      /* ignore storage errors */
    }
    setMapOpen(true);
  };

  const handleIntroContinue = () => {
    try {
      localStorage.setItem(MAP_INTRO_STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setIntroOpen(false);
    setMapOpen(true);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack spacing={1} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Acciones secundarias
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {onValidateWithoutSave && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<CheckCircle />}
              onClick={onValidateWithoutSave}
              disabled={validatePending}
            >
              Validar sin guardar
            </Button>
          )}
          {onOpenMetadata && (
            <Button size="small" variant="outlined" startIcon={<EditNote />} onClick={onOpenMetadata}>
              Ver datos técnicos
            </Button>
          )}
          <Button size="small" variant="outlined" startIcon={<Map />} onClick={openMapFlow}>
            Ver mapa
          </Button>
        </Stack>
        {compactToolbar && (
          <>
            <Divider />
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {onDownloadJson && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Download />}
                  onClick={onDownloadJson}
                  disabled={downloadPending}
                >
                  Descargar JSON
                </Button>
              )}
              {onImportJson && (
                <Button size="small" variant="outlined" onClick={onImportJson}>
                  Importar JSON
                </Button>
              )}
            </Stack>
          </>
        )}
      </Stack>

      <Tabs
        value={tab}
        onChange={(_, v: MoreToolsTabValue) => {
          setTab(v);
          setLoadedTabs(prev => ({ ...prev, [v]: true }));
        }}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 1 }}
      >
        <Tab label="Conexiones" value="connections" />
        <Tab label="Historial" value="history" />
        <Tab label="Mapa" value="map" />
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {tab === 'connections' && loadedTabs.connections && (
          <ConnectionsTable viewModel={viewModel} onRowActivate={onConnectionRowActivate} />
        )}
        {tab === 'history' && (
          <HistoryTimeline
            flowId={flowId}
            editorDirty={editorDirty}
            onRestoreSuccess={onRestoreSuccess}
            enabled={loadedTabs.history}
          />
        )}
        {tab === 'map' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
            <Typography variant="body2" color="text.secondary">
              Mapa de lectura con profundidad y búsqueda. Los cambios se hacen en la vista principal del
              editor.
            </Typography>
            <Button variant="contained" color="secondary" startIcon={<Map />} onClick={openMapFlow}>
              Abrir mapa
            </Button>
          </Box>
        )}
      </Box>

      <AdvancedMapIntroDialog
        open={introOpen}
        onCancel={() => setIntroOpen(false)}
        onContinue={handleIntroContinue}
      />
      <AdvancedMapView
        open={mapOpen}
        flow={draftFlow}
        focusNodeId={focusNodeId}
        onClose={() => setMapOpen(false)}
        onNodeSelect={id => {
          onMapNodeSelect?.(id);
          setMapOpen(false);
        }}
      />
    </Box>
  );
};
