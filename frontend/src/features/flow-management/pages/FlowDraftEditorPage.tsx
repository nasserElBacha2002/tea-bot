import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { FlowValidationPanel } from '../components/FlowValidationPanel';
import {
  useCreateTransition,
  useDeleteTransition,
  useDiscardDraft,
  useFlowVersion,
  usePublishFlowVersion,
  useUpdateFlowNode,
  useValidateFlowVersion,
} from '../hooks/useFlowManagement';
import type { FlowNodeRecord, FlowTransitionRecord } from '../types/flowManagement.types';

export const FlowDraftEditorPage: React.FC = () => {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useFlowVersion(versionId);
  const updateNode = useUpdateFlowNode(versionId || '');
  const validate = useValidateFlowVersion(versionId || '');
  const publish = usePublishFlowVersion(versionId || '');
  const discard = useDiscardDraft(versionId || '');
  const createTransition = useCreateTransition(versionId || '');

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [validation, setValidation] = useState(data?.validation);

  const selectedNode = useMemo(
    () => data?.nodes.find((n) => n.id === selectedNodeId) || data?.nodes[0],
    [data, selectedNodeId],
  );

  const nodeTransitions = useMemo(() => {
    if (!selectedNode || !data) return [];
    return data.transitions.filter((t) => t.sourceNodeKey === selectedNode.nodeKey);
  }, [data, selectedNode]);

  React.useEffect(() => {
    if (selectedNode) setMessage(selectedNode.message || '');
    if (data?.validation) setValidation(data.validation);
  }, [selectedNode, data?.validation]);

  if (isLoading) return <CircularProgress sx={{ m: 3 }} />;
  if (isError) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {(error as Error).message}
      </Alert>
    );
  }
  if (!data || data.version.status !== 'draft') {
    return (
      <Alert severity="warning" sx={{ m: 3 }}>
        Solo se pueden editar versiones en estado borrador.
      </Alert>
    );
  }

  const handleSaveMessage = async () => {
    if (!selectedNode) return;
    try {
      await updateNode.mutateAsync({
        nodeId: selectedNode.id,
        patch: { message },
      });
      setAlert({ type: 'success', text: 'Mensaje guardado.' });
      refetch();
    } catch (e: unknown) {
      setAlert({ type: 'error', text: (e as Error).message });
    }
  };

  const handleValidate = async () => {
    try {
      const r = await validate.mutateAsync();
      setValidation(r);
    } catch (e: unknown) {
      setAlert({ type: 'error', text: (e as Error).message });
    }
  };

  const handlePublish = async () => {
    try {
      const r = await validate.mutateAsync();
      setValidation(r);
      if (!r.valid) {
        setAlert({ type: 'error', text: 'El borrador tiene errores y no puede publicarse.' });
        return;
      }
      await publish.mutateAsync();
      setAlert({ type: 'success', text: 'Versión publicada correctamente.' });
      navigate(`/admin/flows/${data.flow.id}/versions`);
    } catch (e: unknown) {
      setAlert({ type: 'error', text: (e as Error).message });
    }
  };

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <Button size="small" onClick={() => navigate(`/admin/flow-versions/${versionId}`)}>
          ← Inspector
        </Button>
        <Typography variant="h6" fontWeight={800} sx={{ flex: 1 }}>
          Editor de borrador — {data.version.versionLabel}
        </Typography>
        <Button size="small" variant="outlined" onClick={handleSaveMessage} disabled={updateNode.isPending}>
          Guardar
        </Button>
        <Button size="small" variant="outlined" onClick={handleValidate} disabled={validate.isPending}>
          Validar
        </Button>
        <Button size="small" variant="contained" onClick={handlePublish} disabled={publish.isPending}>
          Publicar
        </Button>
        <Button
          size="small"
          color="error"
          onClick={async () => {
            await discard.mutateAsync();
            navigate(`/admin/flows/${data.flow.id}/versions`);
          }}
        >
          Descartar borrador
        </Button>
      </Box>

      {alert && (
        <Alert severity={alert.type} onClose={() => setAlert(null)} sx={{ mb: 1 }}>
          {alert.text}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flex: 1, gap: 2, minHeight: 0 }}>
        <Paper variant="outlined" sx={{ width: 260, overflow: 'auto' }}>
          <Typography variant="subtitle2" sx={{ p: 1, fontWeight: 700 }}>
            Nodos
          </Typography>
          <List dense disablePadding>
            {data.nodes.map((n) => (
              <ListItemButton
                key={n.id}
                selected={selectedNode?.id === n.id}
                onClick={() => setSelectedNodeId(n.id)}
              >
                <ListItemText primary={n.nodeKey} secondary={n.type} />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        <Paper variant="outlined" sx={{ flex: 1, p: 2, overflow: 'auto' }}>
          {selectedNode && (
            <>
              <Typography variant="subtitle1" fontWeight={700}>
                {selectedNode.nodeKey}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Tipo: {selectedNode.type}
              </Typography>
              <TextField
                label="Mensaje"
                fullWidth
                multiline
                minRows={4}
                sx={{ mt: 2 }}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" fontWeight={700}>
                Transiciones
              </Typography>
              {nodeTransitions.map((t) => (
                <TransitionRow
                  key={t.id}
                  transition={t}
                  versionId={versionId!}
                  onDeleted={refetch}
                />
              ))}
              <AddTransitionForm
                node={selectedNode}
                allNodes={data.nodes}
                onAdd={async (body) => {
                  await createTransition.mutateAsync({ nodeId: selectedNode.id, body });
                  refetch();
                }}
              />
            </>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ width: 320, p: 2, overflow: 'auto' }}>
          <FlowValidationPanel result={validation} loading={validate.isPending} />
        </Paper>
      </Box>
    </Box>
  );
};

function TransitionRow({
  transition,
  versionId,
  onDeleted,
}: {
  transition: FlowTransitionRecord;
  versionId: string;
  onDeleted: () => void;
}) {
  const deleteTransition = useDeleteTransition(versionId);
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', my: 0.5 }}>
      <Typography variant="body2" sx={{ flex: 1 }}>
        {transition.type} → {transition.nextNodeKey}
        {transition.value != null ? ` (${String(transition.value)})` : ''}
      </Typography>
      <Button
        size="small"
        color="error"
        onClick={async () => {
          await deleteTransition.mutateAsync(transition.id);
          onDeleted();
        }}
      >
        Eliminar
      </Button>
    </Box>
  );
}

function AddTransitionForm({
  node,
  allNodes,
  onAdd,
}: {
  node: FlowNodeRecord;
  allNodes: FlowNodeRecord[];
  onAdd: (body: { type: string; value?: string; nextNodeKey: string }) => Promise<void>;
}) {
  const [type, setType] = useState('match');
  const [value, setValue] = useState('');
  const [next, setNext] = useState('');

  return (
    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="caption" fontWeight={700}>
        Agregar transición
      </Typography>
      <TextField size="small" label="Tipo" value={type} onChange={(e) => setType(e.target.value)} />
      <TextField size="small" label="Valor" value={value} onChange={(e) => setValue(e.target.value)} />
      <TextField
        size="small"
        label="Destino (clave del nodo)"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={allNodes[0]?.nodeKey}
      />
      <Button
        size="small"
        variant="outlined"
        onClick={() => onAdd({ type, value: value || undefined, nextNodeKey: next })}
        disabled={!next}
      >
        Agregar transición
      </Button>
    </Box>
  );
}
