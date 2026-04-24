import React, { useState } from 'react';
import { Box, Button, Tab, Tabs, Typography } from '@mui/material';
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
  onRestoreSuccess: () => void | Promise<void>;
  onConnectionRowActivate?: (row: ConnectionRow) => void;
}

export const MoreToolsPanel: React.FC<MoreToolsPanelProps> = ({
  flowId,
  viewModel,
  draftFlow,
  editorDirty,
  onRestoreSuccess,
  onConnectionRowActivate,
}) => {
  const [tab, setTab] = useState<MoreToolsTabValue>('connections');
  const [introOpen, setIntroOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

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
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 1 }}
      >
        <Tab label="Conexiones" value="connections" />
        <Tab label="Historial" value="history" />
        <Tab label="Mapa" value="map" />
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {tab === 'connections' && (
          <ConnectionsTable viewModel={viewModel} onRowActivate={onConnectionRowActivate} />
        )}
        {tab === 'history' && (
          <HistoryTimeline
            flowId={flowId}
            editorDirty={editorDirty}
            onRestoreSuccess={onRestoreSuccess}
          />
        )}
        {tab === 'map' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
            <Typography variant="body2" color="text.secondary">
              Visualizá la conversación completa en un mapa. Es útil para flujos grandes; los cambios seguís
              haciéndolos en la vista normal.
            </Typography>
            <Button variant="contained" color="secondary" onClick={openMapFlow}>
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
      <AdvancedMapView open={mapOpen} flow={draftFlow} onClose={() => setMapOpen(false)} />
    </Box>
  );
};
