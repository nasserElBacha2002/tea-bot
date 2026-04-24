import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

function formatCapturedValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(v => formatCapturedValue(v)).join(', ');
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}: ${formatCapturedValue(v)}`).join('; ');
  }
  return String(value);
}

export interface SimulatorDetailsAccordionProps {
  currentStepTitle: string;
  variables: Record<string, unknown>;
}

export const SimulatorDetailsAccordion: React.FC<SimulatorDetailsAccordionProps> = ({
  currentStepTitle,
  variables,
}) => {
  const rows = Object.entries(variables);
  const stepLabel = currentStepTitle.trim() || '—';

  return (
    <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}>
        <Typography variant="caption" fontWeight={600} color="text.secondary">
          Detalles (opcional)
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          Paso actual (título)
        </Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {stepLabel}
        </Typography>
        <Table size="small" sx={{ '& .MuiTableCell-root': { borderColor: 'divider' } }}>
          <TableHead>
            <TableRow>
              <TableCell>Dato</TableCell>
              <TableCell>Valor</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2}>
                  <Typography variant="body2" color="text.secondary">
                    Aún no se guardó ningún dato
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map(([key, val]) => (
                <TableRow key={key}>
                  <TableCell sx={{ fontWeight: 500 }}>{key}</TableCell>
                  <TableCell>{formatCapturedValue(val)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </AccordionDetails>
    </Accordion>
  );
};
