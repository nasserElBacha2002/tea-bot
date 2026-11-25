import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { isConversationDbEnabled, withTransaction } from '../db/index.js';
import {
  RETENTION_SWEEP_LOCK_RESOURCE,
  releaseSessionAppLock,
  tryAcquireSessionAppLock,
  verifySessionAppLockHeld,
} from '../db/session-app-lock.js';
import conversationRepository from '../repositories/conversation.repository.js';
import sessionService from './session.service.js';
import { computeRetentionCutoff } from '../utils/conversation-retention.js';
import { noteRetentionSignal } from '../monitoring/job-status.store.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import inboundMediaService from './inbound-media.service.js';
import { isShuttingDown } from '../process/shutdown-coordinator.js';
import { CHANNEL_WHATSAPP } from '../constants/conversation-channels.js';
import {
  ackPendingStorageDelete,
  countPendingStorageDeletes,
  isStorageKeyEligibleForDelete,
  listPendingStorageDeletes,
} from '../repositories/retention-pending-storage.repository.js';

const DISTRIBUTED_LOCK_TIMEOUT_MS = 0;

const ROW_LEVEL_EVENTS = new Set(['sql_deleted', 'runtime_cleaned', 'runtime_cleanup_failed', 'runtime_cleanup_skipped']);

function logRetention(event, payload = {}) {
  const quietRows = process.env.TB_QUIET_RETENTION_ROW_LOGS === '1';
  if (!(quietRows && ROW_LEVEL_EVENTS.has(event))) {
    console.log(JSON.stringify({
      event,
      job: 'conversation_retention',
      ...payload,
    }));
  }
  try {
    noteRetentionSignal(event, payload);
  } catch (error) {
    console.error(`[Monitoring] retention signal failed: ${error.message}`);
  }
}

/**
 * Job diario: elimina conversaciones inactivas respecto del cutoff.
 * Limpieza runtime condicionada a conversationId; lock distribuido vía sp_getapplock.
 */
export class ConversationRetentionService {
  /**
   * @param {{
   *   conversationRepo?: typeof conversationRepository,
   *   attachmentRepo?: typeof attachmentRepository,
   *   mediaService?: typeof inboundMediaService,
   *   runtimeSession?: typeof sessionService,
   *   runTransaction?: typeof withTransaction,
   *   dbEnabled?: () => boolean,
   *   acquireLock?: typeof tryAcquireSessionAppLock,
   *   releaseLock?: typeof releaseSessionAppLock,
   *   verifyLock?: (resource: string) => Promise<boolean>,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.attachmentRepo = deps.attachmentRepo || attachmentRepository;
    this.mediaService = deps.mediaService || inboundMediaService;
    this.runtimeSession = deps.runtimeSession || sessionService;
    this.runTransaction = deps.runTransaction || withTransaction;
    this.dbEnabled = deps.dbEnabled || isConversationDbEnabled;
    this.acquireLock = deps.acquireLock || tryAcquireSessionAppLock;
    this.releaseLock = deps.releaseLock || releaseSessionAppLock;
    this.verifyLock = deps.verifyLock || verifySessionAppLockHeld;
    this.timer = null;
    this.running = false;
    this.stopped = false;
    /** @type {Promise<unknown> | null} */
    this.activeSweep = null;
  /** @type {Map<string, { conversationId: string, externalUserId: string, channel: string }>} */
    this.pendingRuntimeCleanup = new Map();
    /** @type {Set<string>} */
    this.pendingMediaDeletes = new Set();
    this.mediaQueueState = {
      hydrateFailed: false,
      countUncertain: false,
      ackFailed: 0,
    };
  }

  isEnabled() {
    return Boolean(config.conversationRetentionEnabled) && this.dbEnabled();
  }

  start() {
    if (!this.isEnabled()) return;
    if (this.timer) return;
    this.stopped = false;
    const intervalMs = Number(config.conversationRetentionIntervalHours) * 60 * 60 * 1000;
    void this.runScheduledSweep();
    this.timer = setInterval(() => {
      void this.runScheduledSweep();
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(
      `[ConversationRetention] enabled days=${config.conversationRetentionDays} intervalHours=${config.conversationRetentionIntervalHours} batchSize=${config.conversationRetentionBatchSize}`,
    );
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.activeSweep) {
      await this.activeSweep.catch(() => {});
    }
  }

  async runScheduledSweep(options = {}) {
    try {
      return await this.runSweep(options);
    } catch (error) {
      logRetention('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        skipped: false,
        failed: true,
        cutoff: null,
        conversationsFound: 0,
        conversationsDeleted: 0,
        runtimeCleaned: 0,
        runtimeCleanupFailed: 0,
        durationMs: 0,
      };
    }
  }

  async runSweep({ now = new Date() } = {}) {
    if (!this.isEnabled() || this.stopped || isShuttingDown()) {
      return {
        skipped: true,
        cutoff: null,
        conversationsFound: 0,
        conversationsDeleted: 0,
        runtimeCleaned: 0,
        runtimeCleanupFailed: 0,
        durationMs: 0,
      };
    }
    if (this.running) {
      logRetention('job_skipped_already_running');
      return {
        skipped: true,
        skipReason: 'local_overlap',
        cutoff: null,
        conversationsFound: 0,
        conversationsDeleted: 0,
        runtimeCleaned: 0,
        runtimeCleanupFailed: 0,
        durationMs: 0,
      };
    }

    this.running = true;
    const sweep = this._runSweepAuthorized({ now });
    this.activeSweep = sweep;
    try {
      return await sweep;
    } finally {
      this.activeSweep = null;
      this.running = false;
    }
  }

  async _runSweepAuthorized({ now = new Date() } = {}) {
    const runId = randomUUID();
    const startedAt = Date.now();
    const cutoff = computeRetentionCutoff(now, config.conversationRetentionDays);
    const batchSize = config.conversationRetentionBatchSize;
    let conversationsFound = 0;
    let conversationsDeleted = 0;
    let runtimeCleaned = 0;
    let runtimeCleanupFailed = 0;
    let runtimeCleanupSkipped = 0;
    let mediaCleanupFailed = 0;
    let deliveryStatusDeleted = 0;
    let batchesProcessed = 0;
    let lockHeld = false;
    let interruptedByShutdown = false;

    try {
      const lock = await this.acquireLock(RETENTION_SWEEP_LOCK_RESOURCE, DISTRIBUTED_LOCK_TIMEOUT_MS);
      if (!lock.acquired) {
        logRetention('job_skipped_distributed_lock', {
          runId,
          returnCode: lock.returnCode ?? null,
        });
        return {
          skipped: true,
          skipReason: 'distributed_lock',
          cutoff,
          conversationsFound: 0,
          conversationsDeleted: 0,
          runtimeCleaned: 0,
          runtimeCleanupFailed: 0,
          durationMs: Date.now() - startedAt,
        };
      }
      lockHeld = true;

      logRetention('job_started', {
        runId,
        cutoff: cutoff.toISOString(),
        retentionDays: config.conversationRetentionDays,
        batchSize,
      });

      await this._hydratePendingMediaFromStore();
      const pendingRetry = await this._retryPendingRuntimeCleanup();
      runtimeCleaned += pendingRetry.cleaned;
      runtimeCleanupFailed += pendingRetry.failed;
      runtimeCleanupSkipped += pendingRetry.skipped;
      const mediaRetry = await this._retryPendingMediaDeletes();
      mediaCleanupFailed += mediaRetry.failed;

      while (!isShuttingDown() && !this.stopped) {
        const deleted = await this.runTransaction(async (transaction) =>
          this.conversationRepo.deleteInactiveRetentionBatch(cutoff, {
            limit: batchSize,
            transaction,
            attachmentRepo: this.attachmentRepo,
          }),
        );
        batchesProcessed += 1;
        const removed = deleted.rows || [];
        deliveryStatusDeleted += Number(deleted.deliveryStatusDeleted || 0);
        if (removed.length === 0) break;
        for (const key of deleted.storageKeys || []) {
          this.pendingMediaDeletes.add(key);
        }

        conversationsFound += removed.length;
        conversationsDeleted += removed.length;
        for (const row of removed) {
          logRetention('sql_deleted', { runId, conversationId: row.id });
        }

        if (lockHeld && !(await this.verifyLock(RETENTION_SWEEP_LOCK_RESOURCE))) {
          throw new Error('distributed_lock_lost');
        }
        const mediaFlush = await this._flushPendingMediaDeletes();
        mediaCleanupFailed += mediaFlush.failed;
        const cleanup = await this._cleanupRuntimeSessions(removed);
        runtimeCleaned += cleanup.cleaned;
        runtimeCleanupFailed += cleanup.failed;
        runtimeCleanupSkipped += cleanup.skipped;
      }

      interruptedByShutdown = isShuttingDown() || this.stopped;
      const durationMs = Date.now() - startedAt;

      if (interruptedByShutdown) {
        logRetention('job_stopped_shutdown', {
          runId,
          conversations_deleted: conversationsDeleted,
          batches_processed: batchesProcessed,
          runtime_cleaned: runtimeCleaned,
          runtime_cleanup_failed: runtimeCleanupFailed,
          pending_runtime_cleanup: this.pendingRuntimeCleanup.size,
          pending_media_deletes: (await this._pendingMediaCount()).count,
          duration: durationMs,
        });
        return {
          skipped: false,
          interrupted: true,
          runId,
          cutoff,
          conversationsFound,
          conversationsDeleted,
          runtimeCleaned,
          runtimeCleanupFailed,
          runtimeCleanupSkipped,
          durationMs,
        };
      }

      const partialRuntime = runtimeCleanupFailed > 0 || this.pendingRuntimeCleanup.size > 0;
      const pendingMediaStats = await this._pendingMediaCount();
      const partialMedia = pendingMediaStats.count > 0
        || mediaCleanupFailed > 0
        || pendingMediaStats.uncertain
        || this.mediaQueueState.hydrateFailed
        || this.mediaQueueState.ackFailed > 0;
      const finishEvent = partialRuntime
        ? 'job_finished_with_runtime_cleanup_failed'
        : partialMedia
          ? 'job_finished_with_media_cleanup_pending'
          : 'job_finished';
      logRetention(finishEvent, {
        runId,
        cutoff: cutoff.toISOString(),
        conversations_found: conversationsFound,
        conversations_deleted: conversationsDeleted,
        delivery_status_deleted: deliveryStatusDeleted,
        batches_processed: batchesProcessed,
        runtime_cleaned: runtimeCleaned,
        runtime_cleanup_skipped: runtimeCleanupSkipped,
        runtime_cleanup_failed: runtimeCleanupFailed,
        pending_runtime_cleanup: this.pendingRuntimeCleanup.size,
        pending_media_deletes: pendingMediaStats.count,
        media_queue_uncertain: pendingMediaStats.uncertain,
        duration: durationMs,
      });
      return {
        skipped: false,
        runId,
        cutoff,
        conversationsFound,
        conversationsDeleted,
        runtimeCleaned,
        runtimeCleanupFailed,
        runtimeCleanupSkipped,
        mediaQueueUncertain: partialMedia,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logRetention('error', {
        runId,
        cutoff: cutoff.toISOString(),
        conversations_found: conversationsFound,
        conversations_deleted: conversationsDeleted,
        runtime_cleaned: runtimeCleaned,
        runtime_cleanup_failed: runtimeCleanupFailed,
        duration: durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (lockHeld) {
        try {
          await this.releaseLock(RETENTION_SWEEP_LOCK_RESOURCE);
        } catch (releaseError) {
          console.error(
            `[ConversationRetention] lock release failed: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
          );
        }
      }
    }
  }

  async _pendingMediaCount() {
    const memory = this.pendingMediaDeletes.size;
    if (!this.dbEnabled()) return { count: memory, uncertain: false };
    try {
      const durable = await countPendingStorageDeletes();
      return { count: Math.max(memory, durable), uncertain: false };
    } catch (error) {
      this.mediaQueueState.countUncertain = true;
      console.error(`[ConversationRetention] pending media count failed: ${error.message}`);
      return { count: memory, uncertain: true };
    }
  }

  async _hydratePendingMediaFromStore() {
    if (!this.dbEnabled()) return;
    try {
      const keys = await listPendingStorageDeletes({ limit: 2000 });
      for (const key of keys) {
        if (isStorageKeyEligibleForDelete(key)) {
          this.pendingMediaDeletes.add(key);
        }
      }
    } catch (error) {
      this.mediaQueueState.hydrateFailed = true;
      console.error(`[ConversationRetention] pending media hydrate failed: ${error.message}`);
      throw error;
    }
  }

  _pendingRuntimeKey(row) {
    return String(row?.conversationId || row?.id || '');
  }

  async _retryPendingRuntimeCleanup() {
    const pending = [...this.pendingRuntimeCleanup.values()];
    return this._cleanupRuntimeSessions(pending);
  }

  async _cleanupRuntimeSessions(rows) {
    let cleaned = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row?.externalUserId) continue;
      const conversationId = row.conversationId || row.id;
      const channel = row.channel || CHANNEL_WHATSAPP;
      try {
        const result = await this.runtimeSession.resetSessionForDeletedConversation(
          row.externalUserId,
          conversationId,
          {
            resolveActiveConversation: () => this.conversationRepo.findByChannelAndExternalUserId(
              channel,
              row.externalUserId,
            ),
          },
        );
        if (
          result.action === 'skipped_bound_to_other_conversation'
          || result.action === 'skipped_new_conversation'
          || result.action === 'skipped_concurrent_mutation'
        ) {
          skipped += 1;
          this.pendingRuntimeCleanup.delete(this._pendingRuntimeKey(row));
          logRetention('runtime_cleanup_skipped', {
            conversationId,
            reason: result.action,
          });
          continue;
        }
        if (result.action === 'no_session') {
          this.pendingRuntimeCleanup.delete(this._pendingRuntimeKey(row));
          continue;
        }
        this.pendingRuntimeCleanup.delete(this._pendingRuntimeKey(row));
        cleaned += 1;
        logRetention('runtime_cleaned', { conversationId: row.id || conversationId });
      } catch (error) {
        failed += 1;
        this.pendingRuntimeCleanup.set(this._pendingRuntimeKey(row), {
          conversationId,
          externalUserId: row.externalUserId,
          channel,
        });
        logRetention('runtime_cleanup_failed', {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { cleaned, failed, skipped };
  }

  async _flushPendingMediaDeletes() {
    let deleted = 0;
    let failed = 0;
    for (const key of [...this.pendingMediaDeletes]) {
      if (!isStorageKeyEligibleForDelete(key)) {
        this.pendingMediaDeletes.delete(key);
        continue;
      }
      const result = await this.mediaService.deleteStoredObjects([key]);
      if (result.deleted > 0 || result.failed === 0) {
        this.pendingMediaDeletes.delete(key);
        try {
          await ackPendingStorageDelete(key);
        } catch (ackError) {
          this.mediaQueueState.ackFailed += 1;
          failed += 1;
          console.error(`[ConversationRetention] pending media ack failed: ${ackError.message}`);
        }
        if (result.deleted > 0) deleted += 1;
      } else if (result.failed > 0) {
        failed += 1;
      }
    }
    return { deleted, failed };
  }

  async _retryPendingMediaDeletes() {
    return this._flushPendingMediaDeletes();
  }
}

const conversationRetentionService = new ConversationRetentionService();
export default conversationRetentionService;