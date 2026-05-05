import React, { useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CircularProgress,
  Typography,
} from '@mui/material';
import type { RestoreTarget } from '../state/useConversationHistory';
import { useConversationHistory } from '../state/useConversationHistory';
import { RestoreDraftDialog } from './RestoreDraftDialog';
import { ImportJsonVersionDialog } from './ImportJsonVersionDialog';

export interface HistoryTimelineProps {
  flowId: string;
  editorDirty: boolean;
  onRestoreSuccess: () => void | Promise<void>;
  enabled?: boolean;
}

export const HistoryTimeline: React.FC<HistoryTimelineProps> = ({
  flowId,
  editorDirty,
  onRestoreSuccess,
  enabled = true,
}) => {
  const {
    versionsQuery,
    restoreVersionToDraft,
    isRestoring,
    validateImportedFlow,
    importJsonAsNewVersion,
    isValidatingImport,
    isImporting,
    lastError,
    clearError,
  } = useConversationHistory(flowId, { enabled });
  const [pending, setPending] = useState<RestoreTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const list = versionsQuery.data?.versions ?? [];
    return [...list].reverse();
  }, [versionsQuery.data?.versions]);

  if (versionsQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }
  if (!enabled) {
    return (
      <Typography variant="body2" color="text.secondary">
        Abrí esta pestaña para cargar el historial de versiones.
      </Typography>
    );
  }

  if (versionsQuery.isError) {
    return (
      <Alert severity="error" sx={{ m: 0 }}>
        {(versionsQuery.error as Error).message}
      </Alert>
    );
  }

  if (!versionsQuery.data) return null;

  const { activeVersion, lastPublishedAt } = versionsQuery.data;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Versiones publicadas
        </Typography>
        <Button variant="outlined" size="small" onClick={() => setImportOpen(true)}>
          Importar JSON
        </Button>
      </Box>
      {importMessage && <Alert severity="success">{importMessage}</Alert>}
      <Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Versión que ven los clientes ahora
        </Typography>
        <Typography variant="subtitle1" fontWeight={700}>
          {activeVersion ?? '—'}
        </Typography>
        {lastPublishedAt && (
          <Typography variant="caption" color="text.secondary" display="block">
            Última publicación: {new Date(lastPublishedAt).toLocaleString()}
          </Typography>
        )}
      </Box>

      {ordered.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aún no hay historial publicado. Cuando publiques, las versiones aparecerán aquí.
        </Typography>
      ) : (
        ordered.map(v => {
          const isLive =
            activeVersion === v.version || activeVersion === v.versionLabel;
          return (
            <Card key={v.version} variant="outlined">
              <CardContent sx={{ pb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {v.versionLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  {new Date(v.publishedAt).toLocaleString()}
                </Typography>
                {isLive && (
                  <Typography variant="caption" color="success.main" fontWeight={600} display="block" sx={{ mt: 0.5 }}>
                    En vivo
                  </Typography>
                )}
              </CardContent>
              <CardActions sx={{ pt: 0, px: 2, pb: 2 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    clearError();
                    setPending({
                      version: v.version,
                      versionLabel: v.versionLabel,
                      publishedAt: v.publishedAt,
                    });
                  }}
                >
                  Traer a mi borrador
                </Button>
              </CardActions>
            </Card>
          );
        })
      )}

      <RestoreDraftDialog
        open={Boolean(pending)}
        target={pending}
        editorDirty={editorDirty}
        loading={isRestoring}
        errorMessage={lastError}
        onClose={() => {
          if (!isRestoring) {
            setPending(null);
            clearError();
          }
        }}
        onConfirm={async () => {
          if (!pending) return;
          const res = await restoreVersionToDraft(pending);
          if (res.ok) {
            setPending(null);
            await onRestoreSuccess();
          }
        }}
      />
      <ImportJsonVersionDialog
        open={importOpen}
        loadingValidate={isValidatingImport}
        loadingCreate={isImporting}
        onClose={() => setImportOpen(false)}
        onValidate={flow => validateImportedFlow(flow)}
        onCreate={async (flow, publish) => {
          try {
            const created = await importJsonAsNewVersion(flow, publish);
            setImportMessage(`Nueva versión creada: ${created.version}.`);
            setImportOpen(false);
            await versionsQuery.refetch();
          } catch (e) {
            if (axios.isAxiosError(e) && e.response?.data && typeof e.response.data === 'object') {
              const msg = (e.response.data as { error?: string }).error;
              throw new Error(msg || e.message);
            }
            throw new Error(
              e instanceof Error ? e.message : 'No se pudo crear la nueva versión desde el JSON.'
            );
          }
        }}
      />
    </Box>
  );
};
