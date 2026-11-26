import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Paper,
  Typography,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Grid,
  Card,
  CardContent,
  Skeleton,
  TextField,
} from '@mui/material';
import axios from 'axios';
import {
  fetchMonitoringOverview,
  fetchOperationalSummary,
  fetchDailyMetrics,
  fetchHandoffsMetrics,
  fetchConversationsMetrics,
  fetchSheetSyncMetrics,
  fetchBillingDashboard,
  downloadBillingDashboardCsv,
  type BillingDashboardResponse,
  type BillingPeriod,
  type MonitoringOverview,
  type MonitoringPeriodQuery,
  type OperationalSummaryResponse,
  type DailyMetricsResponse,
  type HandoffsMetricsResponse,
  type ConversationsMetricsResponse,
  type SheetSyncMetricsResponse,
} from '../api/monitoringApi';
import { formatMonitoringTime, monitoringBadgeColor } from '../monitoringDisplay';
import { DailyBarChart } from '../components/DailyBarChart';
import { BillingCostsPanel } from '../components/BillingCostsPanel';

type PeriodKey = MonitoringPeriodQuery['period'];

function isCanceled(error: unknown) {
  return axios.isCancel(error) || (error instanceof Error && error.name === 'CanceledError');
}

function Badge({ value }: { value: string | null | undefined }) {
  const label = value || 'UNKNOWN';
  return <Chip size="small" label={label} color={monitoringBadgeColor(label)} />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Box sx={{ textAlign: 'right' }}>{children}</Box>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 2, minWidth: 260, flex: '1 1 280px' }}>
      <Typography variant="overline">{title}</Typography>
      {children}
    </Paper>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: string | number | null | undefined; loading?: boolean }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        {loading ? <Skeleton width={48} /> : (
          <Typography variant="h6">{value == null ? '—' : value}</Typography>
        )}
      </CardContent>
    </Card>
  );
}

function formatNullableNumber(value: number | null | undefined) {
  if (value == null) return '—';
  return value;
}

export const MonitoringPage: React.FC = () => {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('7d');
  const [billingCustomStart, setBillingCustomStart] = useState('');
  const [billingCustomEnd, setBillingCustomEnd] = useState('');
  const [billing, setBilling] = useState<BillingDashboardResponse | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [summary, setSummary] = useState<OperationalSummaryResponse | null>(null);
  const [daily, setDaily] = useState<DailyMetricsResponse | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffsMetricsResponse | null>(null);
  const [conversations, setConversations] = useState<ConversationsMetricsResponse | null>(null);
  const [sheets, setSheets] = useState<SheetSyncMetricsResponse | null>(null);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [lastBillingRefreshAt, setLastBillingRefreshAt] = useState<string | null>(null);
  const [csvExporting, setCsvExporting] = useState(false);

  const opsAbortRef = useRef<AbortController | null>(null);
  const billingAbortRef = useRef<AbortController | null>(null);
  const overviewAbortRef = useRef<AbortController | null>(null);
  const opsVersion = useRef(0);
  const billingVersion = useRef(0);
  const overviewVersion = useRef(0);
  const overviewPollRef = useRef<number | null>(null);
  const opsPollRef = useRef<number | null>(null);
  const billingPollRef = useRef<number | null>(null);

  const billingCustomReady = useMemo(
    () => billingPeriod !== 'custom' || (Boolean(billingCustomStart) && Boolean(billingCustomEnd)),
    [billingPeriod, billingCustomStart, billingCustomEnd],
  );

  const billingPeriodKey = useMemo(
    () => (billingPeriod === 'custom'
      ? `custom:${billingCustomStart}:${billingCustomEnd}`
      : billingPeriod),
    [billingPeriod, billingCustomStart, billingCustomEnd],
  );

  const periodQuery = useMemo<MonitoringPeriodQuery>(() => (
    period === 'custom' && customStart && customEnd
      ? { period: 'custom', startDay: customStart, endDay: customEnd }
      : { period: period || '7d' }
  ), [period, customStart, customEnd]);

  const loadOverview = useCallback(async () => {
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    const version = overviewVersion.current + 1;
    overviewVersion.current = version;
    setOverviewLoading(true);
    try {
      const overview = await fetchMonitoringOverview(controller.signal);
      if (version !== overviewVersion.current) return;
      setData(overview);
      setOverviewError(null);
    } catch (error) {
      if (isCanceled(error) || version !== overviewVersion.current) return;
      setOverviewError('No se pudo cargar el resumen de salud del backend.');
    } finally {
      if (version === overviewVersion.current) setOverviewLoading(false);
    }
  }, []);

  const loadOperational = useCallback(async () => {
    opsAbortRef.current?.abort();
    const controller = new AbortController();
    opsAbortRef.current = controller;
    const version = opsVersion.current + 1;
    opsVersion.current = version;
    const signal = controller.signal;
    setOpsLoading(true);
    const results = await Promise.allSettled([
      fetchOperationalSummary(periodQuery, signal),
      fetchDailyMetrics(periodQuery, signal),
      fetchHandoffsMetrics(periodQuery, signal),
      fetchConversationsMetrics(periodQuery, signal),
      fetchSheetSyncMetrics(signal),
    ]);
    if (version !== opsVersion.current) return;
    const errors: string[] = [];
    const apply = <T,>(
      idx: number,
      setter: (value: T) => void,
      label: string,
    ) => {
      const result = results[idx];
      if (result.status === 'fulfilled') {
        setter(result.value as T);
      } else if (!isCanceled(result.reason)) {
        errors.push(label);
      }
    };
    apply(0, setSummary, 'resumen');
    apply(1, setDaily, 'métricas diarias');
    apply(2, setHandoffs, 'derivaciones');
    apply(3, setConversations, 'conversaciones');
    if (results[4].status === 'fulfilled') {
      setSheets(results[4].value);
      setSheetsError(null);
    } else if (!isCanceled(results[4].reason)) {
      setSheetsError('Integración Google Sheets no disponible.');
    }
    setOpsError(errors.length ? `Falló: ${errors.join(', ')}.` : null);
    setOpsLoading(false);
    setLastRefreshAt(new Date().toISOString());
  }, [periodQuery]);

  const loadBilling = useCallback(async () => {
    if (!billingCustomReady) {
      billingAbortRef.current?.abort();
      setBilling(null);
      setBillingLoading(false);
      return;
    }
    billingAbortRef.current?.abort();
    const controller = new AbortController();
    billingAbortRef.current = controller;
    const version = billingVersion.current + 1;
    billingVersion.current = version;
    setBillingLoading(true);
    try {
      const billingMetrics = await fetchBillingDashboard(
        billingPeriod,
        controller.signal,
        billingPeriod === 'custom' ? { startDay: billingCustomStart, endDay: billingCustomEnd } : undefined,
      );
      if (version !== billingVersion.current) return;
      setBilling(billingMetrics);
      setBillingError(null);
      setLastBillingRefreshAt(new Date().toISOString());
    } catch (error) {
      if (isCanceled(error) || version !== billingVersion.current) return;
      if (error instanceof Error && error.message === 'custom_period_incomplete') return;
      setBillingError('No se pudo cargar el panel económico.');
    } finally {
      if (version === billingVersion.current) setBillingLoading(false);
    }
  }, [billingPeriod, billingCustomEnd, billingCustomStart, billingCustomReady]);

  const refreshAll = useCallback(() => {
    void loadOverview();
    void loadOperational();
    void loadBilling();
  }, [loadOverview, loadOperational, loadBilling]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadOperational();
  }, [loadOperational]);

  useEffect(() => {
    setBilling(null);
  }, [billingPeriodKey]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  useEffect(() => {
    if (overviewPollRef.current != null) window.clearInterval(overviewPollRef.current);
    overviewPollRef.current = window.setInterval(() => {
      void loadOverview();
    }, 60_000);
    return () => {
      overviewAbortRef.current?.abort();
      if (overviewPollRef.current != null) window.clearInterval(overviewPollRef.current);
    };
  }, [loadOverview]);

  useEffect(() => {
    if (opsPollRef.current != null) window.clearInterval(opsPollRef.current);
    opsPollRef.current = window.setInterval(() => {
      void loadOperational();
    }, 60_000);
    return () => {
      if (opsPollRef.current != null) window.clearInterval(opsPollRef.current);
    };
  }, [loadOperational]);

  useEffect(() => {
    if (!billingCustomReady) return undefined;
    if (billingPollRef.current != null) window.clearInterval(billingPollRef.current);
    billingPollRef.current = window.setInterval(() => {
      void loadBilling();
    }, 60_000);
    return () => {
      if (billingPollRef.current != null) window.clearInterval(billingPollRef.current);
    };
  }, [loadBilling, billingCustomReady]);

  useEffect(() => () => {
    opsAbortRef.current?.abort();
    billingAbortRef.current?.abort();
    overviewAbortRef.current?.abort();
  }, []);

  const activity = data?.activity;
  const last60 = activity?.last60m;
  const cards = summary?.cards;
  const messagePoints = (daily?.daily ?? []).map((row) => ({
    label: row.dayAr,
    inbound: row.inbound,
    outbound: row.whatsappOutbound,
  }));
  const conversationPoints = (conversations?.dailyNew ?? []).map((row) => ({
    label: row.dayAr,
    value: row.newConversations,
  }));

  const handleCsvExport = async () => {
    setCsvExporting(true);
    try {
      await downloadBillingDashboardCsv(
        billingPeriod,
        billingPeriod === 'custom' ? { startDay: billingCustomStart, endDay: billingCustomEnd } : undefined,
      );
    } catch {
      setBillingError('No se pudo exportar el CSV autenticado.');
    } finally {
      setCsvExporting(false);
    }
  };

  return (
    <Box sx={{ overflow: 'auto', p: { xs: 1.5, sm: 2 }, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ flex: 1 }}>Monitoreo</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={period}
          onChange={(_, value) => value && setPeriod(value as PeriodKey)}
        >
          <ToggleButton value="today">Hoy</ToggleButton>
          <ToggleButton value="7d">7 días</ToggleButton>
          <ToggleButton value="30d">30 días</ToggleButton>
          <ToggleButton value="custom">Personalizado</ToggleButton>
        </ToggleButtonGroup>
        {period === 'custom' && (
          <>
            <TextField size="small" label="Desde" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" label="Hasta" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} InputLabelProps={{ shrink: true }} />
          </>
        )}
        <Button size="small" variant="outlined" onClick={refreshAll} disabled={overviewLoading || opsLoading || billingLoading}>
          Actualizar
        </Button>
      </Box>
      {lastRefreshAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Última actualización operativa: {formatMonitoringTime(lastRefreshAt)}
        </Typography>
      )}
      {overviewError && <Alert severity="error" sx={{ mb: 2 }}>{overviewError}</Alert>}
      {opsError && <Alert severity="warning" sx={{ mb: 2 }}>{opsError}</Alert>}
      {sheetsError && <Alert severity="info" sx={{ mb: 2 }}>{sheetsError}</Alert>}
      {data && (
        <Alert severity={data.diagnosis.severity === 'HEALTHY' ? 'success' : data.diagnosis.severity === 'CRITICAL' ? 'error' : 'warning'} sx={{ mb: 2 }}>
          <strong>{data.diagnosis.status}</strong> — {data.diagnosis.summary}
        </Alert>
      )}

      <Typography variant="overline" sx={{ display: 'block', mb: 1 }}>Resumen operativo</Typography>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}><MetricCard label="Recibidos" value={cards?.messagesReceived} loading={opsLoading && !cards} /></Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}><MetricCard label="Enviados (WA)" value={cards?.messagesSent} loading={opsLoading && !cards} /></Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}><MetricCard label="Conv. activas" value={cards?.activeConversations} loading={opsLoading && !cards} /></Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}><MetricCard label="Deriv. pendientes" value={formatNullableNumber(cards?.pendingHandoffs ?? null)} loading={opsLoading && !cards} /></Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}><MetricCard label="Fallos entrega" value={formatNullableNumber(cards?.deliveryFailedInPeriod ?? null)} loading={opsLoading && !cards} /></Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}><MetricCard label="Última actividad" value={cards?.lastBotActivityAt ? formatMonitoringTime(cards.lastBotActivityAt) : '—'} loading={opsLoading && !cards} /></Grid>
      </Grid>

      {lastBillingRefreshAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Última actualización económica: {formatMonitoringTime(lastBillingRefreshAt)}
        </Typography>
      )}
      {billingError && <Alert severity="error" sx={{ mb: 2 }}>{billingError}</Alert>}
      <BillingCostsPanel
        period={billingPeriod}
        onPeriodChange={setBillingPeriod}
        customStart={billingCustomStart}
        customEnd={billingCustomEnd}
        onCustomStartChange={setBillingCustomStart}
        onCustomEndChange={setBillingCustomEnd}
        data={billing}
        loading={billingLoading}
        onExportCsv={() => { void handleCsvExport(); }}
        exportDisabled={csvExporting}
      />

      {data && (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="overline">Actividad histórica</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
              <Box sx={{ flex: '1 1 320px' }}>
                <DailyBarChart title="Mensajes diarios (entrante / saliente WA)" points={messagePoints} showDual />
              </Box>
              <Box sx={{ flex: '1 1 240px' }}>
                <DailyBarChart title="Conversaciones nuevas por día" points={conversationPoints} />
              </Box>
            </Box>
            <Row label="Automáticos (período)"><Typography variant="body2">{cards?.messagesAutomatic ?? '—'}</Typography></Row>
            <Row label="Manuales (período)"><Typography variant="body2">{cards?.messagesManual ?? '—'}</Typography></Row>
          </Paper>

          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="overline">Derivaciones humanas</Typography>
            <Row label="Pendientes"><Typography variant="body2">{formatNullableNumber(handoffs?.current?.pending ?? null)}</Typography></Row>
            <Row label="Asignadas"><Typography variant="body2">{formatNullableNumber(handoffs?.current?.assigned ?? null)}</Typography></Row>
            <Row label="Resueltas"><Typography variant="body2">{formatNullableNumber(handoffs?.current?.resolved ?? null)}</Typography></Row>
            <Row label="Antigüedad pendiente más antigua (min)"><Typography variant="body2">{formatNullableNumber(handoffs?.current?.oldestPendingAgeMinutes ?? null)}</Typography></Row>
            <Row label="Prom. min hasta asignación"><Typography variant="body2">{formatNullableNumber(handoffs?.period?.avgMinutesToAssign ?? null)}</Typography></Row>
            <Row label="Prom. min hasta resolución"><Typography variant="body2">{formatNullableNumber(handoffs?.period?.avgMinutesToResolve ?? null)}</Typography></Row>
          </Paper>

          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="overline">Integraciones</Typography>
            <Row label="Backend"><Badge value={data.bot.process.up ? 'UP' : 'DOWN'} /></Row>
            <Row label="SQL Server"><Badge value={data.bot.database.ok ? 'CONNECTED' : 'DB_ISSUE'} /></Row>
            <Row label="Runtime"><Badge value={data.bot.operationalState} /></Row>
            <Row label="Twilio scheduler"><Badge value={data.monitoringEnabled ? (data.twilio.status || 'UNKNOWN') : 'DISABLED'} /></Row>
            <Row label="Google Sheets jobs"><Badge value={sheets?.sheetSync?.available === false ? 'N/A' : `${sheets?.sheetSync?.pending ?? '—'} pend.`} /></Row>
            <Row label="Último sync OK"><Typography variant="body2">{formatMonitoringTime(sheets?.sheetSync?.lastSuccessAt ?? null)}</Typography></Row>
            <Row label="Retención"><Badge value={data.jobs.conversationRetention.enabled ? 'ENABLED' : 'DISABLED'} /></Row>
            <Row label="Última retención"><Typography variant="body2">{formatMonitoringTime(data.jobs.conversationRetention.lastRun)}</Typography></Row>
          </Paper>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            <Section title="Bot status">
              <Row label="Process"><Badge value={data.bot.process.up ? 'UP' : 'DOWN'} /></Row>
              <Row label="Bot"><Badge value={data.bot.operationalState} /></Row>
              <Row label="Database"><Badge value={data.bot.database.ok ? 'CONNECTED' : 'DB_ISSUE'} /></Row>
              <Row label="Flows"><Typography variant="body2">{data.bot.flowsLoaded ? 'Cargados' : 'Sin flujo publicado'}</Typography></Row>
              <Row label="Last processed"><Typography variant="body2">{formatMonitoringTime(data.bot.activity.lastProcessedAt)}</Typography></Row>
            </Section>
            <Section title="Twilio">
              <Row label="Account"><Badge value={data.twilio.accountStatus || data.twilio.status} /></Row>
              <Row label="Balance"><Typography variant="body2">{data.balance.balance == null ? '—' : `$${data.balance.balance.toFixed(2)}`}</Typography></Row>
              <Row label="Balance level"><Badge value={data.balance.severity} /></Row>
              <Row label="Days left"><Typography variant="body2">{data.balance.estimatedDaysRemaining ?? '—'}</Typography></Row>
            </Section>
            <Section title="WhatsApp sender">
              <Row label="Sender"><Badge value={data.twilio.senderStatus || 'UNKNOWN'} /></Row>
              <Row label="Quality"><Typography variant="body2">{data.twilio.qualityRating || '—'}</Typography></Row>
              <Row label="Checked"><Typography variant="body2">{formatMonitoringTime(data.twilio.checkedAt)}</Typography></Row>
            </Section>
            <Section title="Database">
              <Row label="Ping"><Badge value={data.bot.database.ok ? 'CONNECTED' : 'DB_ISSUE'} /></Row>
              <Row label="Latency"><Typography variant="body2">{data.bot.database.latencyMs == null ? '—' : `${data.bot.database.latencyMs} ms`}</Typography></Row>
            </Section>
            <Section title="Last activity">
              <Row label="Inbound"><Typography variant="body2">{formatMonitoringTime(data.bot.activity.lastInboundAt)}</Typography></Row>
              <Row label="Outbound"><Typography variant="body2">{formatMonitoringTime(data.bot.activity.lastOutboundAt)}</Typography></Row>
              <Row label="Successful flow"><Typography variant="body2">{formatMonitoringTime(data.bot.activity.lastSuccessfulFlowAt)}</Typography></Row>
              <Row label="Last error"><Typography variant="body2">{formatMonitoringTime(data.bot.activity.lastErrorAt)}</Typography></Row>
            </Section>
            <Section title="Message traffic">
              <Typography variant="caption" color="text.secondary">Last 60 min</Typography>
              <Row label="Inbound"><Typography variant="body2">{last60?.inbound ?? '—'}</Typography></Row>
              <Row label="Outbound"><Typography variant="body2">{last60?.outbound ?? '—'}</Typography></Row>
              <Row label="Failed"><Typography variant="body2">{last60?.failed ?? '—'}</Typography></Row>
              <Row label="Processed"><Typography variant="body2">{last60?.processed ?? '—'}</Typography></Row>
              <Typography variant="caption" color="text.secondary">Last 15 min / 24 h inbound</Typography>
              <Row label="15 min"><Typography variant="body2">{activity?.last15m?.inbound ?? '—'}</Typography></Row>
              <Row label="24 h"><Typography variant="body2">{activity?.last24h?.inbound ?? '—'}</Typography></Row>
            </Section>
            <Section title="Delivery status">
              <Row label="Delivered"><Typography variant="body2">{last60?.delivered ?? '—'}</Typography></Row>
              <Row label="Read"><Typography variant="body2">{last60?.read ?? '—'}</Typography></Row>
              <Row label="Delivery rate"><Typography variant="body2">{activity?.delivery?.deliveryRate == null ? '—' : `${activity.delivery.deliveryRate}%`}</Typography></Row>
              <Row label="Failure rate"><Typography variant="body2">{activity?.delivery?.failureRate == null ? '—' : `${activity.delivery.failureRate}%`}</Typography></Row>
              <Row label="Top errors"><Typography variant="body2">{activity?.delivery?.topErrorCodes?.map((item) => `${item.code} (${item.count})`).join(', ') || '—'}</Typography></Row>
            </Section>
            <Section title="Jobs">
              <Row label="Retention"><Badge value={data.jobs.conversationRetention.enabled ? 'ENABLED' : 'DISABLED'} /></Row>
              <Row label="Last status"><Badge value={data.jobs.conversationRetention.lastStatus || 'UNKNOWN'} /></Row>
              <Row label="Last run"><Typography variant="body2">{formatMonitoringTime(data.jobs.conversationRetention.lastRun)}</Typography></Row>
              <Row label="Last deleted"><Typography variant="body2">{data.jobs.conversationRetention.lastDeleted ?? '—'}</Typography></Row>
              <Row label="Reconciliation"><Badge value={data.reconciliation.status} /></Row>
              <Row label="Sheet jobs fallidos"><Typography variant="body2">{sheets?.sheetSync?.failed ?? '—'}</Typography></Row>
            </Section>
            <Section title="Recent incidents">
              {data.incidents.length === 0 && <Typography variant="body2">Sin incidentes.</Typography>}
              {data.incidents.slice(0, 8).map((incident) => (
                <Box key={incident.id} sx={{ py: 0.75 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Badge value={incident.status} />
                    <Typography variant="body2">{incident.summary}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">{formatMonitoringTime(incident.startedAt)}</Typography>
                </Box>
              ))}
            </Section>
          </Box>
          {!data.monitoringEnabled && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              MONITORING_ENABLED está apagado. Las métricas SQL siguen disponibles; Twilio programado, anomalías y alertas no se consultan.
            </Typography>
          )}
        </>
      )}
      {!data && overviewLoading && <Skeleton height={120} />}
    </Box>
  );
};