import { config } from '../config.js';
import { isConversationDbEnabled, withTransaction } from '../db/index.js';
import conversationRepository from '../repositories/conversation.repository.js';
import sessionService from './session.service.js';
import { computeRetentionCutoff } from '../utils/conversation-retention.js';
import { noteRetentionSignal } from '../monitoring/job-status.store.js';

function logRetention(event, payload = {}) {
  console.log(JSON.stringify({
    event,
    job: 'conversation_retention',
    ...payload,
  }));
  try {
    noteRetentionSignal(event, payload);
  } catch (error) {
    console.error(`[Monitoring] retention signal failed: ${error.message}`);
  }
}

/**
 * Job diario: elimina conversaciones con lastMessageAt < now - RETENTION_DAYS.
 * Reutiliza el patrón setInterval de ConversationAbandonmentService.
 *
 * Elegibilidad y DELETE son un solo statement SQL (deleteInactiveBatchBefore).
 * Multi-instancia: cada proceso puede barrer; el DELETE revalida cutoff, por lo
 * que no se borra actividad nueva. No hay lease distribuido.
 */
export class ConversationRetentionService {
  /**
   * @param {{
   *   conversationRepo?: typeof conversationRepository,
   *   runtimeSession?: typeof sessionService,
   *   runTransaction?: typeof withTransaction,
   *   dbEnabled?: () => boolean,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.runtimeSession = deps.runtimeSession || sessionService;
    this.runTransaction = deps.runTransaction || withTransaction;
    this.dbEnabled = deps.dbEnabled || isConversationDbEnabled;
    this.timer = null;
    this.running = false;
    /** @type {Map<string, { conversationId: string, externalUserId: string }>} */
    this.pendingRuntimeCleanup = new Map();
  }

  isEnabled() {
    return Boolean(config.conversationRetentionEnabled) && this.dbEnabled();
  }

  start() {
    if (!this.isEnabled()) return;
    if (this.timer) return;
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

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Scheduler: nunca deja una Promise rechazada (unhandledRejection).
   * runSweep() sigue propagando errores para callers explícitos/tests.
   */
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

  /**
   * Idempotente: una segunda ejecución no encuentra las ya borradas.
   */
  async runSweep({ now = new Date() } = {}) {
    if (!this.isEnabled()) {
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
        cutoff: null,
        conversationsFound: 0,
        conversationsDeleted: 0,
        runtimeCleaned: 0,
        runtimeCleanupFailed: 0,
        durationMs: 0,
      };
    }

    this.running = true;
    const startedAt = Date.now();
    const cutoff = computeRetentionCutoff(now, config.conversationRetentionDays);
    const batchSize = config.conversationRetentionBatchSize;
    let conversationsFound = 0;
    let conversationsDeleted = 0;
    let runtimeCleaned = 0;
    let runtimeCleanupFailed = 0;

    logRetention('job_started', {
      cutoff: cutoff.toISOString(),
      retentionDays: config.conversationRetentionDays,
      batchSize,
    });

    try {
      const pendingRetry = await this._retryPendingRuntimeCleanup();
      runtimeCleaned += pendingRetry.cleaned;
      runtimeCleanupFailed += pendingRetry.failed;

      while (true) {
        const deleted = await this.runTransaction(async (transaction) => (
          this.conversationRepo.deleteInactiveBatchBefore(cutoff, {
            limit: batchSize,
            transaction,
          })
        ));
        if (deleted.length === 0) break;

        conversationsFound += deleted.length;
        conversationsDeleted += deleted.length;
        for (const row of deleted) {
          logRetention('sql_deleted', { conversationId: row.id });
        }

        const cleanup = await this._cleanupRuntimeSessions(deleted);
        runtimeCleaned += cleanup.cleaned;
        runtimeCleanupFailed += cleanup.failed;
      }

      const durationMs = Date.now() - startedAt;
      const finishEvent = runtimeCleanupFailed > 0
        ? 'job_finished_with_runtime_cleanup_failed'
        : 'job_finished';
      logRetention(finishEvent, {
        cutoff: cutoff.toISOString(),
        conversations_found: conversationsFound,
        conversations_deleted: conversationsDeleted,
        runtime_cleaned: runtimeCleaned,
        runtime_cleanup_failed: runtimeCleanupFailed,
        duration: durationMs,
      });
      return {
        skipped: false,
        cutoff,
        conversationsFound,
        conversationsDeleted,
        runtimeCleaned,
        runtimeCleanupFailed,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logRetention('error', {
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
      this.running = false;
    }
  }

  async _retryPendingRuntimeCleanup() {
    const pending = [...this.pendingRuntimeCleanup.values()];
    return this._cleanupRuntimeSessions(pending);
  }

  async _cleanupRuntimeSessions(rows) {
    let cleaned = 0;
    let failed = 0;
    for (const row of rows) {
      if (!row?.externalUserId) continue;
      try {
        await this.runtimeSession.resetSession(row.externalUserId);
        this.pendingRuntimeCleanup.delete(row.externalUserId);
        cleaned += 1;
        logRetention('runtime_cleaned', { conversationId: row.id });
      } catch (error) {
        failed += 1;
        this.pendingRuntimeCleanup.set(row.externalUserId, {
          conversationId: row.id,
          externalUserId: row.externalUserId,
        });
        logRetention('runtime_cleanup_failed', {
          conversationId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { cleaned, failed };
  }
}

const conversationRetentionService = new ConversationRetentionService();
export default conversationRetentionService;
