import React from 'react';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ConversationViewModel } from '../model/conversationViewModel';
import { buildConnectionRows, type ConnectionRow } from '../model/connectionRows';

export interface ConnectionsTableProps {
  viewModel: ConversationViewModel;
  onRowActivate?: (row: ConnectionRow) => void;
}

export const ConnectionsTable: React.FC<ConnectionsTableProps> = ({ viewModel, onRowActivate }) => {
  const rows = React.useMemo(() => buildConnectionRows(viewModel), [viewModel]);
  const [visibleCount, setVisibleCount] = React.useState(50);
  React.useEffect(() => {
    setVisibleCount(50);
  }, [viewModel.flowId]);

  if (rows.length === 0) {
    return (
      <Box sx={{ py: 3, px: 1 }}>
        <Typography variant="body2" color="text.secondary">
          No hay conexiones entre pasos todavía. Añadí respuestas en cada paso para enlazar con el siguiente.
        </Typography>
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          Mostrando {Math.min(visibleCount, rows.length)} de {rows.length} conexiones
        </Typography>
      </Box>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Paso origen</TableCell>
            <TableCell>Si el cliente…</TableCell>
            <TableCell>Va a</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.slice(0, visibleCount).map(row => (
            <TableRow
              key={row.id}
              hover
              onClick={() => onRowActivate?.(row)}
              sx={{ cursor: onRowActivate ? 'pointer' : 'default' }}
            >
              <TableCell sx={{ fontWeight: 600 }}>{row.originTitle}</TableCell>
              <TableCell>{row.clientPhrase}</TableCell>
              <TableCell>{row.destinationTitle}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {visibleCount < rows.length && (
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'center' }}>
          <Typography
            component="button"
            onClick={() => setVisibleCount(v => Math.min(v + 50, rows.length))}
            style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#1976d2' }}
          >
            Mostrar más
          </Typography>
        </Box>
      )}
    </Paper>
  );
};
