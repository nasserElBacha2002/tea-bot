import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Chip, Paper, Typography, Button } from '@mui/material';
import { fetchMonitoringOverview, type MonitoringOverview } from '../api/monitoringApi';
import { formatMonitoringTime, monitoringBadgeColor } from '../monitoringDisplay';

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

export const MonitoringPage: React.FC = () => {
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchMonitoringOverview());
      setError(null);
    } catch {
      setError('No se pudo cargar el monitoreo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activity = data?.activity;
  const last60 = activity?.last60m;

  return (
    <Box sx={{ overflow: 'auto', p: { xs: 1.5, sm: 2 }, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>Monitoreo</Typography>
        <Button size="small" variant="outlined" onClick={() => void load()} disabled={loading}>
          Actualizar
        </Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {data && (
        <>
          <Alert severity={data.diagnosis.severity === 'HEALTHY' ? 'success' : data.diagnosis.severity === 'CRITICAL' ? 'error' : 'warning'} sx={{ mb: 2 }}>
            <strong>{data.diagnosis.status}</strong> — {data.diagnosis.summary}
          </Alert>
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
              MONITORING_ENABLED está apagado. El panel muestra el proceso y la base; Twilio, anomalías y alertas no se consultan.
            </Typography>
          )}
        </>
      )}
    </Box>
  );
};
