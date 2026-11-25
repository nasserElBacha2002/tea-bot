import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import { upsertJobStatus, readJobStatus } from './monitoring.repository.js';

const retentionMemory = {
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessfulFinishedAt: null,
  lastFailedAt: null,
  lastAttemptAt: null,
  lastDeletedCount: null,
  lastRuntimeCleanupFailed: null,
  lastDurationMs: null,
  lastErrorAt: null,
  lastError: null,
  lastStatus: null,
  lastSkipReason: null,
  activeRunId: null,
  pendingRuntimeCleanup: 0,
  pendingMediaDeletes: 0,
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

function persistRetentionSnapshot(patch = {}) {
  Object.assign(retentionMemory, patch);
  persistLater('conversation_retention', {
    lastStartedAt: retentionMemory.lastStartedAt,
    lastFinishedAt: retentionMemory.lastFinishedAt,
    lastStatus: retentionMemory.lastStatus,
    lastError: retentionMemory.lastError,
    lastDeletedCount: retentionMemory.lastDeletedCount,
    lastRuntimeCleanupFailed: retentionMemory.lastRuntimeCleanupFailed,
    lastDurationMs: retentionMemory.lastDurationMs,
    lastSuccessfulFinishedAt: retentionMemory.lastSuccessfulFinishedAt,
    lastFailedAt: retentionMemory.lastFailedAt,
    lastAttemptAt: retentionMemory.lastAttemptAt,
    lastSkipReason: retentionMemory.lastSkipReason,
    activeRunId: retentionMemory.activeRunId,
    pendingRuntimeCleanup: retentionMemory.pendingRuntimeCleanup,
    pendingMediaDeletes: retentionMemory.pendingMediaDeletes,
  });
}

export function noteRetentionSignal(event, payload = {}) {
  const now = new Date().toISOString();
  if (event === 'job_started') {
    retentionMemory.lastStartedAt = now;
    retentionMemory.lastAttemptAt = now;
    retentionMemory.lastStatus = 'RUNNING';
    retentionMemory.activeRunId = payload.runId || null;
    retentionMemory.lastSkipReason = null;
  } else if (event === 'job_skipped_already_running') {
    retentionMemory.lastAttemptAt = now;
    retentionMemory.lastSkipReason = 'local_overlap';
    persistRetentionSnapshot();
    return;
  } else if (event === 'job_skipped_distributed_lock') {
    retentionMemory.lastAttemptAt = now;
    retentionMemory.lastSkipReason = 'distributed_lock';
    persistRetentionSnapshot();
    return;
  } else if (event === 'job_finished') {
    retentionMemory.lastFinishedAt = now;
    retentionMemory.lastSuccessfulFinishedAt = now;
    retentionMemory.lastDeletedCount = Number(payload.conversations_deleted ?? 0);
    retentionMemory.lastRuntimeCleanupFailed = Number(payload.runtime_cleanup_failed ?? 0);
    retentionMemory.lastDurationMs = Number(payload.duration ?? 0);
    retentionMemory.lastStatus = 'SUCCESS';
    retentionMemory.lastError = null;
    retentionMemory.activeRunId = null;
    retentionMemory.pendingRuntimeCleanup = Number(payload.pending_runtime_cleanup ?? 0);
    retentionMemory.pendingMediaDeletes = Number(payload.pending_media_deletes ?? 0);
  } else if (event === 'job_finished_with_runtime_cleanup_failed' || event === 'job_finished_with_media_cleanup_pending') {
    retentionMemory.lastFinishedAt = now;
    retentionMemory.lastDeletedCount = Number(payload.conversations_deleted ?? 0);
    retentionMemory.lastRuntimeCleanupFailed = Number(payload.runtime_cleanup_failed ?? 0);
    retentionMemory.lastDurationMs = Number(payload.duration ?? 0);
    retentionMemory.lastStatus = 'PARTIAL';
    retentionMemory.lastError = null;
    retentionMemory.activeRunId = null;
    retentionMemory.pendingRuntimeCleanup = Number(payload.pending_runtime_cleanup ?? 0);
    retentionMemory.pendingMediaDeletes = Number(payload.pending_media_deletes ?? 0);
  } else if (event === 'job_stopped_shutdown') {
    retentionMemory.lastFinishedAt = now;
    retentionMemory.lastDeletedCount = Number(payload.conversations_deleted ?? retentionMemory.lastDeletedCount ?? 0);
    retentionMemory.lastRuntimeCleanupFailed = Number(payload.runtime_cleanup_failed ?? retentionMemory.lastRuntimeCleanupFailed ?? 0);
    retentionMemory.lastDurationMs = Number(payload.duration ?? retentionMemory.lastDurationMs ?? 0);
    retentionMemory.pendingRuntimeCleanup = Number(payload.pending_runtime_cleanup ?? retentionMemory.pendingRuntimeCleanup ?? 0);
    retentionMemory.pendingMediaDeletes = Number(payload.pending_media_deletes ?? retentionMemory.pendingMediaDeletes ?? 0);
    retentionMemory.lastStatus = 'SHUTDOWN';
    retentionMemory.lastError = null;
    retentionMemory.activeRunId = null;
  } else if (event === 'error') {
    retentionMemory.lastErrorAt = now;
    retentionMemory.lastFailedAt = now;
    retentionMemory.lastFinishedAt = now;
    retentionMemory.lastError = payload.error ? String(payload.error).slice(0, 400) : null;
    retentionMemory.lastStatus = 'FAILED';
    retentionMemory.activeRunId = null;
  } else {
    return;
  }
  persistRetentionSnapshot();
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
    if (!retentionMemory.lastStatus) {
      retentionMemory.lastStatus = stored.lastStatus === 'RUNNING' ? 'INTERRUPTED' : stored.lastStatus;
    }
    if (stored.lastStatus === 'RUNNING') {
      retentionMemory.activeRunId = null;
    } else if (retentionMemory.activeRunId == null && stored.activeRunId) {
      retentionMemory.activeRunId = stored.activeRunId;
    }
    if (!retentionMemory.lastError) retentionMemory.lastError = stored.lastError;
    if (!retentionMemory.lastSuccessfulFinishedAt) {
      retentionMemory.lastSuccessfulFinishedAt = stored.lastSuccessfulFinishedAt;
    }
    if (!retentionMemory.lastSkipReason) retentionMemory.lastSkipReason = stored.lastSkipReason;
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
    lastSuccessfulFinishedAt: retentionMemory.lastSuccessfulFinishedAt,
    lastFailedAt: retentionMemory.lastFailedAt,
    lastAttemptAt: retentionMemory.lastAttemptAt,
    lastRun: retentionMemory.lastFinishedAt || retentionMemory.lastStartedAt,
    lastDeletedCount: retentionMemory.lastDeletedCount,
    lastDeleted: retentionMemory.lastDeletedCount,
    lastRuntimeCleanupFailed: retentionMemory.lastRuntimeCleanupFailed,
    lastDurationMs: retentionMemory.lastDurationMs,
    lastErrorAt: retentionMemory.lastErrorAt,
    lastStatus: retentionMemory.lastStatus,
    lastSkipReason: retentionMemory.lastSkipReason,
    activeRunId: retentionMemory.activeRunId,
    pendingRuntimeCleanup: retentionMemory.pendingRuntimeCleanup,
    pendingMediaDeletes: retentionMemory.pendingMediaDeletes,
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
    lastSuccessfulFinishedAt: null,
    lastFailedAt: null,
    lastAttemptAt: null,
    lastDeletedCount: null,
    lastRuntimeCleanupFailed: null,
    lastDurationMs: null,
    lastErrorAt: null,
    lastError: null,
    lastStatus: null,
    lastSkipReason: null,
    activeRunId: null,
    pendingRuntimeCleanup: 0,
    pendingMediaDeletes: 0,
  });
  monitorJobs.twilio_health = emptyJob();
  monitorJobs.twilio_reconciliation = emptyJob();
}