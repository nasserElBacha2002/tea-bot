import React from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';
import type { PublishWarningItem } from '../model/publishWarnings';
import { PublishWarningsList } from './PublishWarningsList';

export interface PublishReviewDialogProps {
  open: boolean;
  loadingBaseline: boolean;
  changeSummary: string[];
  blockingWarnings: PublishWarningItem[];
  nonBlockingWarnings: PublishWarningItem[];
  onClose: () => void;
  onContinueNormal: () => void;
  onContinueRisky: () => void;
}

export const PublishReviewDialog: React.FC<PublishReviewDialogProps> = ({
  open,
  loadingBaseline,
  changeSummary,
  blockingWarnings,
  nonBlockingWarnings,
  onClose,
  onContinueNormal,
  onContinueRisky,
}) => {
  const hasBlocking = blockingWarnings.length > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle>Revisar antes de poner en vivo</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Los clientes usarán esta versión en el bot.
        </Typography>

        {loadingBaseline ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              Resumen de cambios
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, mb: 2 }}>
              {changeSummary.map((line, i) => (
                <Typography key={i} component="li" variant="body2" sx={{ mb: 0.5 }}>
                  {line}
                </Typography>
              ))}
            </Box>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              Advertencias
            </Typography>
            <PublishWarningsList blocking={blockingWarnings} nonBlocking={nonBlockingWarnings} />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} color="inherit">
          Cancelar
        </Button>
        {hasBlocking && (
          <Button variant="outlined" color="warning" onClick={onContinueRisky}>
            Publicar con problemas pendientes
          </Button>
        )}
        <Button variant="contained" onClick={onContinueNormal} disabled={hasBlocking || loadingBaseline}>
          Continuar
        </Button>
      </DialogActions>
    </Dialog>
  );
};
