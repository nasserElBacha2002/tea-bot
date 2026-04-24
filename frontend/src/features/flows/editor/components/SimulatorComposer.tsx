import React, { useState } from 'react';
import { Box, Button, TextField } from '@mui/material';

export interface SimulatorComposerProps {
  disabled?: boolean;
  sending?: boolean;
  onSend: (text: string) => void;
}

export const SimulatorComposer: React.FC<SimulatorComposerProps> = ({ disabled, sending, onSend }) => {
  const [value, setValue] = useState('');

  const submit = () => {
    if (!value.trim() || disabled || sending) return;
    onSend(value);
    setValue('');
  };

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', pt: 1 }}>
      <TextField
        size="small"
        fullWidth
        multiline
        maxRows={4}
        placeholder="Escribe como si fueras el cliente"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled || sending}
      />
      <Button variant="contained" size="small" onClick={submit} disabled={disabled || sending || !value.trim()}>
        Enviar
      </Button>
    </Box>
  );
};
