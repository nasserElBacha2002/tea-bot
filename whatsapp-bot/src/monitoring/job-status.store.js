import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import { upsertJobStatus, readJobStatus } from './monitoring.repository.js';

const retentionMemory = {
  lastStartedAt: null,
  lastFinishedAt: null,
  lastDeletedCount: null,
  lastRuntimeCleanupFailed: null,
  lastDurationMs: null,
  lastErrorAt: null,
  lastError: null,
  lastStatus: null,
};

const monitorJobs = {
  twilio_health: emptyJob(),
  twilio_reconciliation: emptyJob(),
};

function emptyJob() {
  return {
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    lastDeletedCount: null,
    lastRuntimeCleanupFailed: null,
    lastDurationMs: null,
  };
}

function persistLater(jobName, fields) {
  if (!config.monitoringEnabled || !isConversationDbEnabled()) return;
  void upsertJobStatus(jobName, fields).catch((error) => {
    console.error(`[Monitoring] job status persist failed: ${error.message}`);
  });
}

export function noteRetentionSignal(event, payload = {}) {
  if (event === 'job_started') {
    retentionMemory.lastStartedAt = new Date().toISOString();
    retentionMemory.lastStatus = 'RUNNING';
  } else if (event === 'job_finished' || event === 'job_finished_with_runtime_cleanup_failed') {
    retentionMemory.lastFinishedAt = new Date().toISOString();
    retentionMemory.lastDeletedCount = Number(payload.conversations_deleted ?? 0);
    retentionMemory.lastRuntimeCleanupFailed = Number(payload.runtime_cleanup_failed ?? 0);
    retentionMemory.lastDurationMs = Number(payload.duration ?? 0);
    retentionMemory.lastStatus = event === 'job_finished' ? 'SUCCESS' : 'CLEANUP_FAILED';
    retentionMemory.lastError = null;
  } else if (event === 'error') {
    retentionMemory.lastErrorAt = new Date().toISOString();
    retentionMemory.lastError = payload.error ? String(payload.error).slice(0, 400) : null;
    retentionMemory.lastStatus = 'FAILED';
  } else {
    return;
  }
  persistLater('conversation_retention', {
    ...retentionMemory,
    lastError: retentionMemory.lastError,
  });
}

export function noteMonitorJob(jobName, patch) {
  if (!monitorJobs[jobName]) monitorJobs[jobName] = emptyJob();
  Object.assign(monitorJobs[jobName], patch);
  persistLater(jobName, monitorJobs[jobName]);
}

export async function hydrateJobMemory() {
  if (!isConversationDbEnabled()) return;
  try {
    const stored = await readJobStatus('conversation_retention');
    if (!stored) return;
    if (!retentionMemory.lastStartedAt) retentionMemory.lastStartedAt = stored.lastStartedAt;
    if (!retentionMemory.lastFinishedAt) retentionMemory.lastFinishedAt = stored.lastFinishedAt;
    if (retentionMemory.lastDeletedCount == null) retentionMemory.lastDeletedCount = stored.lastDeletedCount;
    if (retentionMemory.lastRuntimeCleanupFailed == null) {
      retentionMemory.lastRuntimeCleanupFailed = stored.lastRuntimeCleanupFailed;
    }
    if (retentionMemory.lastDurationMs == null) retentionMemory.lastDurationMs = stored.lastDurationMs;
    if (!retentionMemory.lastStatus) retentionMemory.lastStatus = stored.lastStatus;
    if (!retentionMemory.lastError) retentionMemory.lastError = stored.lastError;
  } catch (error) {
    console.error(`[Monitoring] job status hydrate failed: ${error.message}`);
  }
}

export function getRetentionJobView() {
  return {
    enabled: Boolean(config.conversationRetentionEnabled),
    retentionDays: config.conversationRetentionDays,
    intervalHours: config.conversationRetentionIntervalHours,
    batchSize: config.conversationRetentionBatchSize,
    lastStartedAt: retentionMemory.lastStartedAt,
    lastFinishedAt: retentionMemory.lastFinishedAt,
    lastRun: retentionMemory.lastFinishedAt || retentionMemory.lastStartedAt,
    lastDeletedCount: retentionMemory.lastDeletedCount,
    lastDeleted: retentionMemory.lastDeletedCount,
    lastRuntimeCleanupFailed: retentionMemory.lastRuntimeCleanupFailed,
    lastDurationMs: retentionMemory.lastDurationMs,
    lastErrorAt: retentionMemory.lastErrorAt,
    lastStatus: retentionMemory.lastStatus,
  };
}

export function getMonitorJobView() {
  return {
    twilioHealth: { ...monitorJobs.twilio_health },
    twilioReconciliation: { ...monitorJobs.twilio_reconciliation },
  };
}

export function resetJobStatusForTests() {
  Object.assign(retentionMemory, {
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDeletedCount: null,
    lastRuntimeCleanupFailed: null,
    lastDurationMs: null,
    lastErrorAt: null,
    lastError: null,
    lastStatus: null,
  });
  monitorJobs.twilio_health = emptyJob();
  monitorJobs.twilio_reconciliation = emptyJob();
}
