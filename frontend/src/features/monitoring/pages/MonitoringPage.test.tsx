// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { MonitoringPage } from './MonitoringPage';

vi.mock('../api/monitoringApi', () => ({
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

describe('MonitoringPage', () => {
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
