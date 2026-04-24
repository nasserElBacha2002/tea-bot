import React, { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Paper, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography, Alert,
} from '@mui/material';
import {
  Add, Archive, ContentCopy, Edit, CloudUpload,
} from '@mui/icons-material';
import { useFlows, useCreateFlow, usePublishFlow, useDuplicateFlow, useArchiveFlow } from '../hooks/useFlows';
import type { Flow } from '../types/flow.types';
import { flowStatusLabel } from '../utils/flowUiLabels';

function buildSkeletonFlow(id: string, name: string): Partial<Flow> {
  return {
    id,
    name,
    version: 'draft',
    entryNode: 'welcome',
    fallbackNode: 'not-understood',
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        message: '¡Hola! ¿En qué puedo ayudarte?',
        transitions: [{ type: 'default', nextNode: 'not-understood' }],
        ui: { position: { x: 80, y: 80 } },
      },
      {
        id: 'not-understood',
        type: 'message',
        message: 'No entendí. Intenta de nuevo, por favor.',
        transitions: [{ type: 'default', nextNode: 'welcome' }],
        ui: { position: { x: 440, y: 80 } },
      },
    ],
  };
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  draft: 'warning',
  published: 'success',
  archived: 'error',
};

export const FlowListPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: flows, isLoading, isError } = useFlows();

  const createFlow = useCreateFlow();
  const publishFlow = usePublishFlow();
  const duplicateFlow = useDuplicateFlow();
  const archiveFlow = useArchiveFlow();

  const [createOpen, setCreateOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [dupOpen, setDupOpen] = useState(false);
  const [dupSourceId, setDupSourceId] = useState('');
  const [dupNewId, setDupNewId] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const handleCreate = async () => {
    if (!newId.trim() || !newName.trim()) return;
    try {
      await createFlow.mutateAsync(buildSkeletonFlow(newId.trim(), newName.trim()));
      setCreateOpen(false);
      navigate(`/flows/${newId.trim()}/conversation`);
    } catch (e: unknown) { setAlert({ type: 'error', msg: (e as Error).message }); }
  };

  const handlePublish = async (flowId: string) => {
    try {
      const res = await publishFlow.mutateAsync(flowId);
      setAlert({ type: 'success', msg: `«${flowId}» publicado como ${res.version}.` });
    } catch (e: unknown) { setAlert({ type: 'error', msg: (e as Error).message }); }
  };

  const handleDuplicate = async () => {
    try {
      await duplicateFlow.mutateAsync({ flowId: dupSourceId, newId: dupNewId.trim() });
      setDupOpen(false);
    } catch (e: unknown) { setAlert({ type: 'error', msg: (e as Error).message }); }
  };

  const handleArchive = async (flowId: string) => {
    if (!confirm(`¿Archivar «${flowId}»? Se quitará del listado de borradores.`)) return;
    try {
      await archiveFlow.mutateAsync(flowId);
    } catch (e: unknown) { setAlert({ type: 'error', msg: (e as Error).message }); }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Flujos</Typography>
          <Typography variant="body2" color="text.secondary">Administra los borradores de tus flujos conversacionales.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => { setNewId(''); setNewName(''); setCreateOpen(true); }}>
          Nuevo flujo
        </Button>
      </Box>

      {alert && (
        <Alert severity={alert.type} onClose={() => setAlert(null)} sx={{ mb: 2 }}>
          {alert.msg}
        </Alert>
      )}

      {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>}

      {isError && (
        <Alert severity="error">No se pudieron cargar los flujos. Comprueba que el servidor esté en ejecución (puerto 3000).</Alert>
      )}

      {!isLoading && !isError && flows?.length === 0 && (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <Typography color="text.secondary">Aún no hay flujos. Crea el primero.</Typography>
        </Paper>
      )}

      {!isLoading && !isError && flows && flows.length > 0 && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><b>Nombre</b></TableCell>
                <TableCell><b>ID</b></TableCell>
                <TableCell><b>Versión</b></TableCell>
                <TableCell><b>Estado</b></TableCell>
                <TableCell><b>Actualizado</b></TableCell>
                <TableCell align="right"><b>Acciones</b></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {flows.map(f => (
                <TableRow key={f.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{f.name}</Typography>
                  </TableCell>
                  <TableCell><Chip label={f.id} size="small" variant="outlined" /></TableCell>
                  <TableCell>{f.version === 'draft' ? 'Borrador' : f.version}</TableCell>
                  <TableCell>
                    <Chip label={flowStatusLabel(f.status)} size="small" color={STATUS_COLORS[f.status] ?? 'default'} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{f.updatedAt ? new Date(f.updatedAt).toLocaleString() : '—'}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Editar conversación">
                      <Button
                        component={RouterLink}
                        to={`/flows/${f.id}/conversation`}
                        size="small"
                        variant="contained"
                        startIcon={<Edit fontSize="small" />}
                        sx={{ mr: 0.5, minWidth: 0, px: 1 }}
                      >
                        Editar
                      </Button>
                    </Tooltip>
                    <Tooltip title="Publicar"><IconButton size="small" color="primary" onClick={() => handlePublish(f.id)}><CloudUpload fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Duplicar">
                      <IconButton size="small" onClick={() => { setDupSourceId(f.id); setDupNewId(''); setDupOpen(true); }}>
                        <ContentCopy fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Archivar"><IconButton size="small" color="error" onClick={() => handleArchive(f.id)}><Archive fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogTitle>Crear flujo</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField size="small" label="ID del flujo" value={newId} onChange={e => setNewId(e.target.value)} helperText="Sin espacios. Ej.: checkout-flow" />
          <TextField size="small" label="Nombre del flujo" value={newName} onChange={e => setNewName(e.target.value)} helperText="Nombre legible para humanos." />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!newId.trim() || !newName.trim() || createFlow.isPending}>Crear</Button>
        </DialogActions>
      </Dialog>

      {/* Duplicate dialog */}
      <Dialog open={dupOpen} onClose={() => setDupOpen(false)}>
        <DialogTitle>Duplicar «{dupSourceId}»</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth size="small" label="Nuevo ID de flujo" value={dupNewId}
            onChange={e => setDupNewId(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDupOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={handleDuplicate} disabled={!dupNewId.trim() || duplicateFlow.isPending}>Duplicar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
