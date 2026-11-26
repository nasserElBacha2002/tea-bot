// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MonitoringPage } from './MonitoringPage';

const operationalMock = {
  ok: true,
  generatedAt: '2026-10-16T12:00:00.000Z',
  monitoringEnabled: true,
  cards: {
    messagesReceived: 12,
    messagesSent: 15,
    messagesAutomatic: 10,
    messagesManual: 5,
    deliveryFailedInPeriod: 1,
    activeConversations: 8,
    pendingHandoffs: 2,
    lastBotActivityAt: '2026-10-16T11:58:00.000Z',
  },
};

vi.mock('../api/monitoringApi', () => ({
  fetchOperationalSummary: vi.fn(async () => operationalMock),
  fetchDailyMetrics: vi.fn(async () => ({
    ok: true,
    generatedAt: '2026-10-16T12:00:00.000Z',
    daily: [{ dayAr: '2026-10-15', inbound: 4, outbound: 6, outboundBot: 5, outboundAgent: 1, whatsappOutbound: 6 }],
    window: { startDayAr: '2026-10-15', endDayAr: '2026-10-16', presentationTimeZone: 'Argentina Standard Time' },
  })),
  fetchHandoffsMetrics: vi.fn(async () => ({
    ok: true,
    current: { pending: 2, assigned: 1, resolved: 5, oldestPendingAgeMinutes: 12 },
    period: { createdInPeriod: 3, avgMinutesToAssign: 4, avgMinutesToResolve: 30 },
  })),
  fetchConversationsMetrics: vi.fn(async () => ({
    ok: true,
    dailyNew: [{ dayAr: '2026-10-15', newConversations: 2 }],
    snapshot: { active: 8, closed: 3, botManaged: 5, waitingHuman: 2 },
  })),
  fetchBillingDashboard: vi.fn(async () => ({
    generatedAt: '2026-10-16T12:00:00.000Z',
    monitoringEnabled: false,
    externalBillingFetchEnabled: false,
    indicators: {
      messagesReceived: 12,
      messagesSent: 15,
      twilioCostUsd: 0.12,
      metaCostUsd: 0.08,
      totalCostUsd: 0.2,
      avgDailyUsd: 0.02,
      avgPerMessageUsd: 0.013,
      projectedMonthlyUsd: 0.6,
      freeTier: { allowance: 1000, consumedBeforeWindow: 0, consumedAfterWindow: 10, remaining: 990, percentConsumed: 1 },
      balance: { available: false },
    },
    dataQuality: { estimatedCosts: 'estimated_sql_proxy', providerConfirmed: 'not_fetched' },
    charts: { dailyCosts: [{ dayAr: '2026-10-15', twilioEstimatedUsd: 0.05, metaEstimatedUsd: 0.03, totalEstimatedUsd: 0.08 }], dailyMessages: [{ dayAr: '2026-10-15', inbound: 2, outbound: 3, outboundBot: 2, outboundAgent: 1 }] },
    table: { daily: [{ dayAr: '2026-10-15', inbound: 2, outbound: 3, outboundBot: 2, outboundAgent: 1, freeService: 1, billableService: 2, twilioEstimatedUsd: 0.05, metaEstimatedUsd: 0.03, totalEstimatedUsd: 0.08 }] },
    provider: { quality: 'not_fetched' },
  })),
  downloadBillingDashboardCsv: vi.fn(async () => undefined),
  fetchSheetSyncMetrics: vi.fn(async () => ({
    ok: true,
    sheetSync: { available: true, pending: 0, failed: 0, completed: 4, lastSuccessAt: '2026-10-16T11:00:00.000Z' },
  })),
  fetchMonitoringOverview: vi.fn(async () => ({
    ok: true,
    generatedAt: '2026-10-16T12:00:00.000Z',
    monitoringEnabled: true,
    diagnosis: {
      status: 'PROVIDER_ISSUE',
      severity: 'CRITICAL',
      summary: 'Possible upstream inbound routing issue',
      signals: [],
    },
    bot: {
      status: 'HEALTHY',
      operationalState: 'BOT_OPERATIONAL',
      process: { up: true, startedAt: '2026-10-16T11:00:00.000Z' },
      database: { ok: true, latencyMs: 12 },
      flowsLoaded: true,
      activity: {
        lastInboundAt: null,
        lastOutboundAt: '2026-10-16T11:58:00.000Z',
        lastProcessedAt: '2026-10-16T11:58:00.000Z',
        lastSuccessfulFlowAt: '2026-10-16T11:50:00.000Z',
        lastErrorAt: null,
      },
    },
    twilio: {
      status: 'HEALTHY',
      accountStatus: 'active',
      balance: 49.89,
      currency: 'USD',
      senderStatus: 'ONLINE',
      qualityRating: 'HIGH',
      offlineReasons: null,
      senderSid: 'XE1',
      webhookUrl: null,
      checkedAt: '2026-10-16T11:55:00.000Z',
      latencyMs: 240,
      error: null,
    },
    balance: {
      balance: 49.89,
      severity: 'HEALTHY',
      avgDailySpend: null,
      estimatedDaysRemaining: null,
    },
    activity: {
      available: true,
      last60m: { inbound: 0, outbound: 17, failed: 0, delivered: 17, read: 0, processed: 17 },
      last15m: { inbound: 0, outbound: 4, failed: 0, processed: 4 },
      last24h: { inbound: 10, outbound: 20, failed: 0, processed: 30 },
      delivery: { sample: 17, deliveryRate: 100, failureRate: 0, readRate: 0, topErrorCodes: [] },
    },
    reconciliation: {
      status: 'TWILIO_AND_DB_OK',
      missingCount: 0,
      dbOnlyCount: 0,
      truncated: false,
      checkedAt: '2026-10-16T11:55:00.000Z',
    },
    jobs: {
      conversationRetention: {
        enabled: false,
        retentionDays: 30,
        intervalHours: 24,
        batchSize: 100,
        lastRun: null,
        lastDeleted: null,
        lastStatus: null,
        lastDurationMs: null,
        lastRuntimeCleanupFailed: null,
        lastErrorAt: null,
      },
      retentionStale: false,
    },
    incidents: [],
  })),
}));

describe('MonitoringPage polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no repite overview antes de 60s y sí tras 60s', async () => {
    const { fetchMonitoringOverview, fetchOperationalSummary } = await import('../api/monitoringApi');
    vi.mocked(fetchMonitoringOverview).mockClear();
    vi.mocked(fetchOperationalSummary).mockClear();
    render(
      <ThemeProvider theme={createTheme()}>
        <MonitoringPage />
      </ThemeProvider>,
    );
    await vi.advanceTimersByTimeAsync(0);
    const initialOverview = vi.mocked(fetchMonitoringOverview).mock.calls.length;
    const initialOps = vi.mocked(fetchOperationalSummary).mock.calls.length;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(vi.mocked(fetchMonitoringOverview).mock.calls.length).toBe(initialOverview);
    expect(vi.mocked(fetchOperationalSummary).mock.calls.length).toBe(initialOps);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.mocked(fetchMonitoringOverview).mock.calls.length).toBeGreaterThan(initialOverview);
    expect(vi.mocked(fetchOperationalSummary).mock.calls.length).toBeGreaterThan(initialOps);
  });
});

describe('MonitoringPage', () => {
  it('sigue mostrando salud si el dashboard económico falla', async () => {
    const { fetchBillingDashboard } = await import('../api/monitoringApi');
    vi.mocked(fetchBillingDashboard).mockRejectedValueOnce(new Error('billing down'));
    render(
      <ThemeProvider theme={createTheme()}>
        <MonitoringPage />
      </ThemeProvider>,
    );
    expect(await screen.findByText(/Possible upstream inbound routing issue/)).toBeTruthy();
    expect(await screen.findByText(/panel económico/i)).toBeTruthy();
  });

  it('muestra el diagnóstico de ruteo inbound', async () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <MonitoringPage />
      </ThemeProvider>,
    );
    expect(await screen.findByText(/Possible upstream inbound routing issue/)).toBeTruthy();
    expect(screen.getByText('ONLINE')).toBeTruthy();
    expect(screen.getByText('$49.89')).toBeTruthy();
  });
});
