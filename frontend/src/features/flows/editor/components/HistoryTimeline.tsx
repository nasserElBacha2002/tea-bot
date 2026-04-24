import React, { useMemo, useState } from 'react';
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

export interface HistoryTimelineProps {
  flowId: string;
  editorDirty: boolean;
  onRestoreSuccess: () => void | Promise<void>;
}

export const HistoryTimeline: React.FC<HistoryTimelineProps> = ({
  flowId,
  editorDirty,
  onRestoreSuccess,
}) => {
  const { versionsQuery, restoreVersionToDraft, isRestoring, lastError, clearError } =
    useConversationHistory(flowId);
  const [pending, setPending] = useState<RestoreTarget | null>(null);

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
    </Box>
  );
};
