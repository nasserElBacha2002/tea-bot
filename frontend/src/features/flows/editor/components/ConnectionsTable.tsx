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
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Paso origen</TableCell>
            <TableCell>Si el cliente…</TableCell>
            <TableCell>Va a</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(row => (
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
    </Paper>
  );
};
