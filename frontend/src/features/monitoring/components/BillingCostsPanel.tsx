import { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  TextField,
  Typography,
} from '@mui/material';
import type { BillingDashboardResponse } from '../api/monitoringApi';
import { DailyBarChart } from './DailyBarChart';
import { formatMonitoringTime } from '../monitoringDisplay';

export type BillingPeriod =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | 'current_month'
  | 'previous_month'
  | 'custom';

interface Props {
  period: BillingPeriod;
  onPeriodChange: (value: BillingPeriod) => void;
  customStart?: string;
  customEnd?: string;
  onCustomStartChange?: (value: string) => void;
  onCustomEndChange?: (value: string) => void;
  data: BillingDashboardResponse | null;
  loading: boolean;
  onExportCsv: () => void;
  exportDisabled?: boolean;
}

function money(value: number | null | undefined, quality?: string) {
  if (value == null) return '—';
  return `${value.toFixed(4)}${quality?.includes('estimated') ? ' (est.)' : ''}`;
}

function chartMoney(value: number | null | undefined) {
  return value == null ? null : value;
}

export function BillingCostsPanel({
  period,
  onPeriodChange,
  customStart = '',
  customEnd = '',
  onCustomStartChange,
  onCustomEndChange,
  data,
  loading,
  onExportCsv,
  exportDisabled,
}: Props) {
  const costPoints = useMemo(() => (data?.charts.dailyCosts ?? []).map((row) => ({
    label: row.dayAr,
    inbound: chartMoney(row.twilioConfirmedUsd ?? row.twilioEstimatedUsd) ?? 0,
    outbound: chartMoney(row.metaConfirmedUsd ?? row.metaEstimatedUsd) ?? 0,
  })), [data]);

  const messageMixPoints = useMemo(() => (data?.charts.dailyMessages ?? []).map((row) => ({
    label: row.dayAr,
    inbound: row.outboundBot,
    outbound: row.outboundAgent,
  })), [data]);

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1 }}>
        <Typography variant="overline" sx={{ flex: 1 }}>Costos y consumo</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={period}
          onChange={(_, value) => value && onPeriodChange(value as BillingPeriod)}
        >
          <ToggleButton value="today">Hoy</ToggleButton>
          <ToggleButton value="yesterday">Ayer</ToggleButton>
          <ToggleButton value="7d">7 días</ToggleButton>
          <ToggleButton value="30d">30 días</ToggleButton>
          <ToggleButton value="current_month">Mes actual</ToggleButton>
          <ToggleButton value="previous_month">Mes anterior</ToggleButton>
          <ToggleButton value="custom">Personalizado</ToggleButton>
        </ToggleButtonGroup>
        {period === 'custom' && (
          <>
            <TextField size="small" label="Desde" type="date" value={customStart} onChange={(e) => onCustomStartChange?.(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" label="Hasta" type="date" value={customEnd} onChange={(e) => onCustomEndChange?.(e.target.value)} InputLabelProps={{ shrink: true }} />
          </>
        )}
        <Button size="small" variant="outlined" onClick={onExportCsv} disabled={loading || !data || exportDisabled}>
          Exportar CSV
        </Button>
      </Box>

      {data?.dataQuality.providerConfirmed === 'not_fetched' && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Costos Twilio/Meta confirmados no sincronizados (fetchUsage deshabilitado por defecto). Se muestran estimaciones SQL.
        </Alert>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Período efectivo: {data?.effectivePeriod?.startDayAr ?? '—'} → {data?.effectivePeriod?.endDayAr ?? '—'}
        {data?.generatedAt ? ` · actualizado ${formatMonitoringTime(data.generatedAt)}` : ''}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Chip label={`Twilio: ${money(data?.indicators.twilioCostUsd, data?.indicators.twilioCostQuality)}`} size="small" />
        <Chip label={`Meta: ${money(data?.indicators.metaCostUsd, data?.indicators.metaCostQuality)}`} size="small" />
        <Chip label={`Subtotal: ${money(data?.indicators.knownSubtotalUsd ?? data?.indicators.totalCostUsd)}`} size="small" />
        <Chip label={`Total: ${money(data?.indicators.totalCostUsd)}`} size="small" color="primary" />
        <Chip
          label={`Franquicia: ${data?.indicators.freeTier.remaining ?? '—'} restantes`}
          size="small"
          variant="outlined"
        />
        <Chip
          label={`Saldo: ${data?.indicators.balance.balanceUsd == null ? '—' : `$${data.indicators.balance.balanceUsd}`}`}
          size="small"
          color={data?.indicators.balance.severity === 'critical' ? 'error' : 'default'}
        />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Promedio diario {money(data?.indicators.avgDailyUsd)} · por mensaje {money(data?.indicators.avgPerMessageUsd)}
        · proyección 30d {money(data?.indicators.projectedMonthlyUsd)}
        {data?.provider.cache?.usageCachedAt ? ` · cache usage ${formatMonitoringTime(data.provider.cache.usageCachedAt)}` : ''}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Box sx={{ flex: '1 1 300px' }}>
          <DailyBarChart title="Costo diario Twilio (est./conf.) vs Meta" points={costPoints} showDual />
        </Box>
        <Box sx={{ flex: '1 1 240px' }}>
          <DailyBarChart title="Mensajes automáticos vs manuales" points={messageMixPoints} showDual />
        </Box>
      </Box>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Fecha AR</TableCell>
            <TableCell align="right">Inbound</TableCell>
            <TableCell align="right">Outbound</TableCell>
            <TableCell align="right">Gratis</TableCell>
            <TableCell align="right">Facturables</TableCell>
            <TableCell align="right">Twilio</TableCell>
            <TableCell align="right">Meta</TableCell>
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(data?.table.daily ?? []).map((row) => (
            <TableRow key={row.dayAr}>
              <TableCell>{row.dayAr}</TableCell>
              <TableCell align="right">{row.inbound}</TableCell>
              <TableCell align="right">{row.outbound}</TableCell>
              <TableCell align="right">{row.freeService ?? '—'}</TableCell>
              <TableCell align="right">{row.billableService ?? '—'}</TableCell>
              <TableCell align="right">{money(row.twilioConfirmedUsd ?? row.twilioEstimatedUsd)}</TableCell>
              <TableCell align="right">{money(row.metaConfirmedUsd ?? row.metaEstimatedUsd)}</TableCell>
              <TableCell align="right">{money(row.totalConfirmedUsd ?? row.totalEstimatedUsd)}</TableCell>
            </TableRow>
          ))}
          {!loading && (data?.table.daily?.length ?? 0) === 0 && (
            <TableRow>
              <TableCell colSpan={8}>Sin filas agregadas para el período.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}