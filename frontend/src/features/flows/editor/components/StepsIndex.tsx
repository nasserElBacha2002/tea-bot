import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import type { ConversationStep } from '../model/conversationViewModel';
import {
  buildStepPathDisplayOrder,
  getStepPathRowSx,
  type StepPathDisplayItem,
} from '../model/stepPathOrdering';

export interface StepsIndexProps {
  steps: ConversationStep[];
  entryStepId: string;
  activeStepId: string | null;
  onStepSelect: (internalId: string) => void;
}

/**
 * Índice lateral de pasos ordenado por recorrido del flujo (no por id).
 */
export const StepsIndex: React.FC<StepsIndexProps> = ({
  steps,
  entryStepId,
  activeStepId,
  onStepSelect,
}) => {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(60);
  const isFiltering = query.trim().length > 0;

  const displayItems = useMemo(
    () => buildStepPathDisplayOrder(steps, entryStepId),
    [steps, entryStepId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return displayItems;
    return displayItems.filter(
      item =>
        item.step.title.toLowerCase().includes(q) ||
        item.step.internalId.toLowerCase().includes(q),
    );
  }, [query, displayItems]);

  const visibleRows = useMemo(
    () => (isFiltering ? filtered : filtered.slice(0, visibleCount)),
    [filtered, isFiltering, visibleCount],
  );

  useEffect(() => {
    if (!activeStepId) return;
    requestAnimationFrame(() => {
      const el = rowRefs.current[activeStepId];
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [activeStepId, displayItems]);

  const renderRow = (item: StepPathDisplayItem) => {
    const selected = activeStepId === item.step.internalId;
    return (
      <ListItemButton
        key={item.step.internalId}
        ref={el => {
          rowRefs.current[item.step.internalId] = el;
        }}
        selected={selected}
        onClick={() => onStepSelect(item.step.internalId)}
        sx={{
          borderRadius: 1,
          mb: 0.25,
          ...getStepPathRowSx(item, selected),
        }}
        data-step-id={item.step.internalId}
        data-depth={item.depth}
        data-branch-group={item.branchGroup}
        data-section={item.section}
      >
        <ListItemText
          primaryTypographyProps={{ variant: 'body2', noWrap: true, fontWeight: 600 }}
          secondary={`${item.pathOrder}`}
          primary={item.step.title}
        />
      </ListItemButton>
    );
  };

  const pathRows = visibleRows.filter(item => item.section === 'path');
  const orphanRows = visibleRows.filter(item => item.section === 'orphan');
  const showOrphanHeader =
    orphanRows.length > 0 &&
    (pathRows.length > 0 || (pathRows.length === 0 && orphanRows.length > 0));

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
        {pathRows.map(renderRow)}
        {showOrphanHeader ? (
          <>
            <Divider sx={{ my: 0.75 }} />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ px: 1, py: 0.5, display: 'block', fontWeight: 700 }}
            >
              Pasos desconectados
            </Typography>
          </>
        ) : null}
        {orphanRows.map(renderRow)}
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
