import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { FlowVersionStatusBadge } from '../components/FlowVersionStatusBadge';
import { FlowValidationPanel } from '../components/FlowValidationPanel';
import { useFlowVersion } from '../hooks/useFlowManagement';
import { flowManagementApi } from '../api/flowManagementApi';

export const FlowVersionInspectorPage: React.FC = () => {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useFlowVersion(versionId);
  const [snapshotText, setSnapshotText] = useState<string | null>(null);

  const loadSnapshot = async () => {
    if (!versionId) return;
    const snap = await flowManagementApi.getSnapshot(versionId);
    setSnapshotText(JSON.stringify(snap.snapshot, null, 2));
  };

  if (isLoading) return <CircularProgress sx={{ m: 3 }} />;
  if (isError) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {(error as Error).message}
      </Alert>
    );
  }
  if (!data) return null;

  const { version, flow, nodes, transitions, validation, snapshot } = data;

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto', width: '100%' }}>
      <Button size="small" onClick={() => navigate(`/admin/flows/${flow.id}/versions`)} sx={{ mb: 1 }}>
        ← Versiones
      </Button>
      <Typography variant="h5" fontWeight={800} gutterBottom>
        {flow.name} — {version.versionLabel}
      </Typography>
      <FlowVersionStatusBadge status={version.status} />

      <Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="body2">
          <strong>Nodo de entrada:</strong> {version.entryNodeKey}
        </Typography>
        {version.fallbackNodeKey && (
          <Typography variant="body2">
            <strong>Nodo fallback:</strong> {version.fallbackNodeKey}
          </Typography>
        )}
        {snapshot?.checksum && (
          <Typography variant="body2">
            <strong>Checksum:</strong> {snapshot.checksum.slice(0, 16)}…
          </Typography>
        )}
      </Box>

      {version.status === 'draft' && (
        <Button
          sx={{ mt: 2 }}
          variant="contained"
          onClick={() => navigate(`/admin/flow-versions/${versionId}/edit`)}
        >
          Editar borrador
        </Button>
      )}

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          Validación
        </Typography>
        <FlowValidationPanel result={validation} />
      </Box>

      <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3 }}>
        Nodos ({nodes.length})
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mt: 1, maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Clave</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell>Mensaje</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {nodes.map((n) => (
              <TableRow key={n.id}>
                <TableCell>{n.nodeKey}</TableCell>
                <TableCell>{n.type}</TableCell>
                <TableCell sx={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(n.message || '').slice(0, 80)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3 }}>
        Transiciones ({transitions.length})
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mt: 1, maxHeight: 240 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Origen</TableCell>
              <TableCell>Tipo</TableCell>
              <TableCell>Valor</TableCell>
              <TableCell>Destino</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transitions.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.sourceNodeKey}</TableCell>
                <TableCell>{t.type}</TableCell>
                <TableCell>{t.value != null ? String(t.value) : '—'}</TableCell>
                <TableCell>{t.nextNodeKey}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Accordion sx={{ mt: 3 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>Ver snapshot JSON</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Button size="small" onClick={loadSnapshot} sx={{ mb: 1 }}>
            Cargar snapshot
          </Button>
          {snapshotText && (
            <Box
              component="pre"
              sx={{
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 400,
                bgcolor: 'grey.100',
                p: 1,
                borderRadius: 1,
              }}
            >
              {snapshotText}
            </Box>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};
