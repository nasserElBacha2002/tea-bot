import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Stack, TextField, Button, CircularProgress } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

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
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setValue(displayName ?? '');
    }
  }, [displayName, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleCancel = () => {
    setValue(displayName ?? '');
    setEditing(false);
  };

  const handleSave = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    await onSave(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <IconButton
        size="small"
        aria-label="Editar nombre del contacto"
        onClick={() => setEditing(true)}
        sx={{ ml: 0.5 }}
      >
        <EditOutlinedIcon fontSize="small" />
      </IconButton>
    );
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <TextField
          inputRef={inputRef}
          size="small"
          label="Nombre del contacto"
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
              handleCancel();
            }
          }}
          disabled={saving}
          error={Boolean(error)}
          helperText={error ?? ' '}
          sx={{ minWidth: 220, flex: 1 }}
        />
        <Button
          size="small"
          variant="contained"
          onClick={() => void handleSave()}
          disabled={saving || !value.trim()}
        >
          {saving ? <CircularProgress size={18} color="inherit" /> : 'Guardar'}
        </Button>
        <Button size="small" onClick={handleCancel} disabled={saving}>
          Cancelar
        </Button>
      </Stack>
    </Box>
  );
};
