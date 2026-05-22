import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
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
import { FlowVersionStatusBadge } from '../components/FlowVersionStatusBadge';
import {
  useCreateDraft,
  useDiscardDraft,
  useFlowVersions,
  usePublishFlowVersion,
  useValidateFlowVersion,
} from '../hooks/useFlowManagement';
import { flowManagementApi } from '../api/flowManagementApi';
import type { FlowVersionStatus } from '../types/flowManagement.types';

export const FlowMgmtDetailPage: React.FC = () => {
  const { flowId } = useParams<{ flowId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useFlowVersions(flowId);
  const createDraft = useCreateDraft(flowId || '');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleCreateDraft = async (baseVersionId: string) => {
    try {
      const draft = await createDraft.mutateAsync(baseVersionId);
      setMsg({ type: 'success', text: 'Borrador creado correctamente.' });
      navigate(`/admin/flow-versions/${draft.id}/edit`);
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  const handleRollback = async (versionId: string) => {
    try {
      const res = await flowManagementApi.rollback(versionId, false);
      setMsg({ type: 'success', text: 'Borrador de rollback creado.' });
      if (res.draft?.id) navigate(`/admin/flow-versions/${res.draft.id}/edit`);
      refetch();
    } catch (e: unknown) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto', width: '100%' }}>
      <Button size="small" onClick={() => navigate('/admin/flows')} sx={{ mb: 1 }}>
        ← Flujos
      </Button>
      <Typography variant="h5" fontWeight={800} gutterBottom>
        Versiones del flujo
      </Typography>
      {data?.flow && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {data.flow.name} ({data.flow.flowKey})
        </Typography>
      )}

      {msg && (
        <Alert severity={msg.type} sx={{ mb: 2 }} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(error as Error).message}
        </Alert>
      )}

      {isLoading ? (
        <CircularProgress />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Versión</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Nodo de entrada</TableCell>
                <TableCell>Nodos</TableCell>
                <TableCell>Transiciones</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.items || []).map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  onView={() => navigate(`/admin/flow-versions/${v.id}`)}
                  onEdit={() => navigate(`/admin/flow-versions/${v.id}/edit`)}
                  onCreateDraft={() => handleCreateDraft(v.id)}
                  onRollback={() => handleRollback(v.id)}
                  flowId={flowId!}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
};

function VersionRow({
  version,
  onView,
  onEdit,
  onCreateDraft,
  onRollback,
  flowId: _flowId,
}: {
  version: {
    id: string;
    versionLabel: string;
    status: FlowVersionStatus;
    entryNodeKey: string;
    nodesCount: number;
    transitionsCount: number;
  };
  onView: () => void;
  onEdit: () => void;
  onCreateDraft: () => void;
  onRollback: () => void;
  flowId: string;
}) {
  const discard = useDiscardDraft(version.id);
  const publish = usePublishFlowVersion(version.id);
  const validate = useValidateFlowVersion(version.id);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  return (
    <TableRow hover>
      <TableCell>{version.versionLabel}</TableCell>
      <TableCell>
        <FlowVersionStatusBadge status={version.status} />
      </TableCell>
      <TableCell>{version.entryNodeKey}</TableCell>
      <TableCell>{version.nodesCount}</TableCell>
      <TableCell>{version.transitionsCount}</TableCell>
      <TableCell align="right">
        <Button size="small" onClick={onView}>
          Ver
        </Button>
        {version.status === 'draft' && (
          <>
            <Button size="small" sx={{ ml: 0.5 }} onClick={onEdit}>
              Editar borrador
            </Button>
            <Button
              size="small"
              sx={{ ml: 0.5 }}
              disabled={validate.isPending}
              onClick={async () => {
                try {
                  const r = await validate.mutateAsync();
                  setLocalMsg(r.valid ? 'Válido' : 'Tiene errores');
                } catch (e: unknown) {
                  setLocalMsg((e as Error).message);
                }
              }}
            >
              Validar
            </Button>
            <Button
              size="small"
              sx={{ ml: 0.5 }}
              color="primary"
              disabled={publish.isPending}
              onClick={async () => {
                try {
                  await validate.mutateAsync();
                  await publish.mutateAsync();
                  setLocalMsg('Versión publicada correctamente.');
                } catch (e: unknown) {
                  setLocalMsg((e as Error).message);
                }
              }}
            >
              Publicar
            </Button>
            <Button
              size="small"
              sx={{ ml: 0.5 }}
              color="error"
              disabled={discard.isPending}
              onClick={async () => {
                try {
                  await discard.mutateAsync();
                  setLocalMsg('Borrador descartado correctamente.');
                } catch (e: unknown) {
                  setLocalMsg((e as Error).message);
                }
              }}
            >
              Descartar borrador
            </Button>
          </>
        )}
        {version.status !== 'draft' && (
          <Button size="small" sx={{ ml: 0.5 }} onClick={onCreateDraft}>
            Crear borrador
          </Button>
        )}
        {version.status === 'archived' && (
          <Button size="small" sx={{ ml: 0.5 }} onClick={onRollback}>
            Crear rollback
          </Button>
        )}
        {localMsg && (
          <Typography variant="caption" display="block" color="text.secondary">
            {localMsg}
          </Typography>
        )}
      </TableCell>
    </TableRow>
  );
}
