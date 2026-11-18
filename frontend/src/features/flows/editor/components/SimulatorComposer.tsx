import React, { useRef, useState } from 'react';
import { Box, Button, IconButton, TextField, Typography } from '@mui/material';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import CloseIcon from '@mui/icons-material/Close';

export interface SimulatorComposerProps {
  disabled?: boolean;
  sending?: boolean;
  onSend: (text: string, file?: File | null) => void;
}

const ALLOWED_ACCEPT = 'image/jpeg,image/png,application/pdf';

export const SimulatorComposer: React.FC<SimulatorComposerProps> = ({ disabled, sending, onSend }) => {
  const [value, setValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    if ((!value.trim() && !file) || disabled || sending) return;
    onSend(value, file);
    setValue('');
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, pt: 1 }}>
      {file && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
            {file.name}
          </Typography>
          <IconButton size="small" aria-label="Quitar archivo" onClick={() => {
            setFile(null);
            if (inputRef.current) inputRef.current.value = '';
          }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_ACCEPT}
          hidden
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <IconButton
          size="small"
          aria-label="Adjuntar archivo"
          disabled={disabled || sending}
          onClick={() => inputRef.current?.click()}
        >
          <AttachFileOutlinedIcon fontSize="small" />
        </IconButton>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={4}
          placeholder="Escribe como si fueras el cliente"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled || sending}
        />
        <Button
          variant="contained"
          size="small"
          onClick={submit}
          disabled={disabled || sending || (!value.trim() && !file)}
        >
          Enviar
        </Button>
      </Box>
    </Box>
  );
};