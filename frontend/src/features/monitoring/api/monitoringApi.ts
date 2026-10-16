import axios from 'axios';
import { resolveApiOrigin } from '../../../utils/apiOrigin';

const client = axios.create({
  baseURL: `${resolveApiOrigin()}/api/monitoring`,
  withCredentials: true,
});

export interface MonitoringDiagnosis {
  status: string;
  severity: string;
  summary: string;
  signals: Array<{ name: string; value: unknown }>;
}

export interface MonitoringOverview {
  ok: boolean;
  generatedAt: string;
  monitoringEnabled: boolean;
  diagnosis: MonitoringDiagnosis;
  bot: {
    status: string;
    operationalState: string;
    process: { up: boolean; startedAt: string };
    database: { ok: boolean; latencyMs: number | null };
    flowsLoaded: boolean;
    activity: {
      lastInboundAt: string | null;
      lastOutboundAt: string | null;
      lastProcessedAt: string | null;
      lastSuccessfulFlowAt: string | null;
      lastErrorAt: string | null;
      activityPersistenceOk?: boolean;
    };
  };
  twilio: {
    status: string;
    accountStatus: string | null;
    balance: number | null;
    currency: string | null;
    senderStatus: string | null;
    qualityRating: string | null;
    offlineReasons: unknown;
    senderSid: string | null;
    webhookUrl: string | null;
    checkedAt: string | null;
    latencyMs: number | null;
    error: string | null;
  };
  balance: {
    balance: number | null;
    severity: string;
    avgDailySpend: number | null;
    estimatedDaysRemaining: number | null;
  };
  activity: {
    available?: boolean;
    reason?: string;
    last15m?: { inbound: number; outbound: number; failed: number; processed: number };
    last60m?: {
      inbound: number;
      outbound: number;
      failed: number;
      delivered?: number;
      read?: number;
      processed: number;
    };
    last24h?: { inbound: number; outbound: number; failed: number; processed: number };
    delivery?: {
      sample: number;
      deliveryRate: number | null;
      failureRate: number | null;
      readRate: number | null;
      topErrorCodes: Array<{ code: string; count: number }>;
    };
    anomaly?: { anomaly: boolean; reason: string; actual: number | null; expected: number | null };
  } | null;
  reconciliation: {
    status: string;
    missingCount: number;
    dbOnlyCount: number;
    truncated: boolean;
    checkedAt: string | null;
  };
  jobs: {
    conversationRetention: {
      enabled: boolean;
      retentionDays: number;
      intervalHours: number;
      batchSize: number;
      lastRun: string | null;
      lastDeleted: number | null;
      lastStatus: string | null;
      lastDurationMs: number | null;
      lastRuntimeCleanupFailed: number | null;
      lastErrorAt: string | null;
    };
    retentionStale: boolean;
  };
  incidents: Array<{
    id: string;
    type: string;
    severity: string;
    status: string;
    startedAt: string;
    resolvedAt: string | null;
    summary: string;
  }>;
}

export async function fetchMonitoringOverview(): Promise<MonitoringOverview> {
  const { data } = await client.get<MonitoringOverview>('/overview');
  return data;
}
