import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  IconButton,
  Stack,
  TextField,
  Button,
  CircularProgress,
  Popover,
  Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { conversationUiDensity } from '../constants/conversationUiDensity';

interface Props {
  displayName: string | null;
  saving?: boolean;
  error?: string | null;
  onSave: (name: string) => Promise<void>;
}

export const ContactNameEditor: React.FC<Props> = ({
  displayName,
  saving = false,
  error = null,
  onSave,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState(displayName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const handleClose = () => {
    setValue(displayName ?? '');
    setAnchorEl(null);
  };

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    await onSave(trimmed);
    setAnchorEl(null);
  };

  return (
    <>
      <IconButton
        size="small"
        aria-label="Editar nombre del contacto"
        aria-expanded={open}
        onClick={(e) => {
          setValue(displayName ?? '');
          setAnchorEl(e.currentTarget);
        }}
        sx={{ flexShrink: 0, ml: 0.25 }}
      >
        <EditOutlinedIcon fontSize="small" />
      </IconButton>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: { p: 1.25, width: 300, maxWidth: 'calc(100vw - 24px)' },
          },
        }}
      >
        <Stack spacing={1}>
          <Typography variant="subtitle2" fontWeight={700}>
            Nombre del contacto
          </Typography>
          <TextField
            inputRef={inputRef}
            size="small"
            label="Nombre"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                void handleSave();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                handleClose();
              }
            }}
            disabled={saving}
            error={Boolean(error)}
            helperText={error ?? ' '}
            fullWidth
            sx={{
              '& .MuiInputBase-root': { minHeight: conversationUiDensity.controlHeight },
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.75 }}>
            <Button size="small" onClick={handleClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => void handleSave()}
              disabled={saving || !value.trim()}
            >
              {saving ? <CircularProgress size={18} color="inherit" /> : 'Guardar'}
            </Button>
          </Box>
        </Stack>
      </Popover>
    </>
  );
};