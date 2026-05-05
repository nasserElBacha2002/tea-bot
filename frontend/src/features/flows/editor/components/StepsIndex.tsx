import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import type { ConversationStep } from '../model/conversationViewModel';

export interface StepsIndexProps {
  steps: ConversationStep[];
  activeStepId: string | null;
  onStepSelect: (internalId: string) => void;
}

/**
 * Índice lateral de pasos (Nivel 1). El scroll al paso lo dispara el padre vía ref o callback.
 */
export const StepsIndex: React.FC<StepsIndexProps> = ({
  steps,
  activeStepId,
  onStepSelect,
}) => {
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(60);
  const isFiltering = query.trim().length > 0;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return steps.map((s, i) => ({ s, i }));
    return steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.title.toLowerCase().includes(q) || s.internalId.toLowerCase().includes(q));
  }, [query, steps]);
  const visibleRows = useMemo(
    () => (isFiltering ? filtered : filtered.slice(0, visibleCount)),
    [filtered, isFiltering, visibleCount]
  );

  return (
    <Box
      sx={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflowY: 'auto',
        display: { xs: 'none', md: 'block' },
      }}
    >
      <Box sx={{ p: 1.5, pb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          Pasos
        </Typography>
      </Box>
      {steps.length > 6 && (
        <Box sx={{ px: 1, pb: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Buscar…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Buscar paso en el índice"
          />
        </Box>
      )}
      <List dense disablePadding sx={{ px: 0.5, pb: 1 }}>
        {visibleRows.map(({ s, i }) => (
          <ListItemButton
            key={s.internalId}
            selected={activeStepId === s.internalId}
            onClick={() => onStepSelect(s.internalId)}
            sx={{ borderRadius: 1, mb: 0.25 }}
          >
            <ListItemText
              primaryTypographyProps={{ variant: 'body2', noWrap: true, fontWeight: 600 }}
              secondary={`${i + 1}`}
              primary={s.title}
            />
          </ListItemButton>
        ))}
      </List>
      {!isFiltering && visibleCount < filtered.length && (
        <Box sx={{ px: 1, pb: 1 }}>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            onClick={() => setVisibleCount(v => Math.min(v + 60, filtered.length))}
          >
            Mostrar más
          </Button>
        </Box>
      )}
    </Box>
  );
};
