import React, { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import { Add } from '@mui/icons-material';
import type { ConversationResponseKind } from '../model/conversationViewModel';

export interface AddResponseMenuProps {
  hasFallback: boolean;
  onSelect: (kind: ConversationResponseKind) => void;
}

export const AddResponseMenu: React.FC<AddResponseMenuProps> = ({ hasFallback, onSelect }) => {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const open = Boolean(anchor);

  const handle = (kind: ConversationResponseKind) => {
    onSelect(kind);
    setAnchor(null);
  };

  return (
    <>
      <Button
        size="small"
        startIcon={<Add />}
        onClick={e => setAnchor(e.currentTarget)}
        variant="outlined"
      >
        Añadir respuesta
      </Button>
      <Menu anchorEl={anchor} open={open} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => handle('exact')}>Solo si dice exactamente…</MenuItem>
        <MenuItem onClick={() => handle('anyOf')}>Si dice cualquiera de estas cosas…</MenuItem>
        <MenuItem onClick={() => handle('fallback')} disabled={hasFallback}>
          En cualquier otro caso
        </MenuItem>
      </Menu>
    </>
  );
};
