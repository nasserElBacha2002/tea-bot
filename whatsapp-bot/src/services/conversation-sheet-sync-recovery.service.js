import conversationSheetSyncJobRepository from '../repositories/conversation-sheet-sync-job.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import { config } from '../config.js';
import { buildSheetWorkerId } from '../utils/sheet-worker-id.js';
import {
  emailPayloadHash,
  runFencedEmailSync,
  finalizeEmailSyncJob,
} from './email-sheet-sync-coordinator.js';

const RECOVERY_INTERVAL_MS = 60_000;
const WORKER_ID = buildSheetWorkerId('email-sync');

export { emailPayloadHash };

export async function enqueueEmailSheetSync(conversationId, email, options = {}) {
  if (!conversationSheetSyncJobRepository.isEnabled() || !conversationId) return null;
  return conversationSheetSyncJobRepository.enqueue(
    conversationId,
    'email',
    emailPayloadHash(email),
    options,
  );
}

export async function enqueueEmailSheetSyncForConversationIds(conversationIds, email, options = {}) {
  const unique = [...new Set((conversationIds || []).filter(Boolean))];
  const results = [];
  for (const conversationId of unique) {
    const row = await enqueueEmailSheetSync(conversationId, email, options);
    if (row) results.push(row);
  }
  return results;
}

export async function runCoordinatedEmailSheetSync(conversationId, email) {
  const job = await conversationSheetSyncJobRepository.findByConversation(conversationId, 'email');
  if (!job) return { skipped: true, reason: 'no_job' };
  const claimed = await conversationSheetSyncJobRepository.claimForInlineSync(
    conversationId,
    'email',
    { jobGeneration: job.jobGeneration, payloadHash: emailPayloadHash(email) },
  );
  if (!claimed) {
    return { skipped: true, reason: 'not_claimed', pendingRecovery: true };
  }
  const outcome = await runFencedEmailSync(claimed, claimed.workerOwner);
  const conversation = await conversationRepository.findById(conversationId);
  const finalized = await finalizeEmailSyncJob(
    claimed,
    claimed.workerOwner,
    conversation?.contactEmail || email,
  );
  return { ...outcome, finalize: finalized };
}

async function processAcquiredJob(job, ownerPrefix) {
  const conversation = await conversationRepository.findById(job.conversationId);
  if (!conversation?.id) {
    await conversationSheetSyncJobRepository.markCompleted(job.id, {
      ownerId: job.workerOwner,
      jobGeneration: job.jobGeneration,
    });
    return { result: 'completed', reason: 'conversation_missing' };
  }
  if (!conversation.contactEmail) {
    await conversationSheetSyncJobRepository.markCompleted(job.id, {
      ownerId: job.workerOwner,
      jobGeneration: job.jobGeneration,
    });
    return { result: 'completed', reason: 'no_email' };
  }

  const tabName = config.googleSheetsTabName;
  const exportRecord = conversationSheetExportRepository.isEnabled()
    ? await conversationSheetExportRepository.findLatestByConversationAndTab(conversation.id, tabName)
    : null;
  if (!exportRecord?.sheetRowNumber) {
    await conversationSheetSyncJobRepository.markRetry(job.id, 'row_not_exported', 120, {
      ownerId: job.workerOwner,
      jobGeneration: job.jobGeneration,
    });
    return { result: 'failed', reason: 'row_not_exported' };
  }

  const current = await conversationSheetSyncJobRepository.findJobFence(job.id);
  if (!current || current.jobGeneration !== job.jobGeneration || current.workerOwner !== job.workerOwner) {
    return { result: 'skipped', reason: 'acquisition_lost' };
  }

  const outcome = await runFencedEmailSync(job, job.workerOwner);
  if (outcome.result === 'reconciled' || outcome.result === 'synced') {
    const finalized = await finalizeEmailSyncJob(job, job.workerOwner, conversation.contactEmail);
    if (finalized.status === 'completed') {
      return { result: 'completed', reason: outcome.reason };
    }
    return { result: 'reconciled', reason: finalized.status };
  }

  if (outcome.sheet?.reason === 'row_not_found') {
    await conversationSheetSyncJobRepository.markRetry(job.id, outcome.sheet.reason, 90, {
      ownerId: job.workerOwner,
      jobGeneration: job.jobGeneration,
    });
    return { result: 'failed', reason: outcome.sheet.reason };
  }
  const retryable = ['disabled', 'missing_config'].includes(outcome.sheet?.reason);
  await conversationSheetSyncJobRepository.markRetry(
    job.id,
    outcome.sheet?.reason || 'skipped',
    retryable ? 120 : 60,
    { ownerId: job.workerOwner, jobGeneration: job.jobGeneration },
  );
  return { result: 'failed', reason: outcome.sheet?.reason || 'skipped' };
}

export async function runDueSheetSyncJobs(options = {}) {
  const limit = options.limit || 25;
  const workerPrefix = options.workerId || WORKER_ID;
  if (!conversationSheetSyncJobRepository.isEnabled()) {
    return { processed: 0, skipped: true, reason: 'db_disabled' };
  }

  const jobs = await conversationSheetSyncJobRepository.acquireDue(limit, workerPrefix);
  let processed = 0;
  let completed = 0;
  let failed = 0;
  let exhaustedObserved = 0;

  for (const job of jobs) {
    processed += 1;
    try {
      const outcome = await processAcquiredJob(job, workerPrefix);
      if (outcome.result === 'completed' || outcome.result === 'reconciled') completed += 1;
      else if (outcome.result !== 'skipped') failed += 1;
    } catch (error) {
      const updated = await conversationSheetSyncJobRepository.markRetry(
        job.id,
        error.message,
        60 * (job.attempts + 1),
        { ownerId: job.workerOwner, jobGeneration: job.jobGeneration },
      );
      if (updated?.status === 'exhausted') {
        exhaustedObserved += 1;
        console.warn(
          `[SheetSyncRecovery] job_exhausted conversationId=${job.conversationId} jobId=${job.id} generation=${job.jobGeneration}`,
        );
      }
      failed += 1;
    }
  }

  return {
    processed,
    completed,
    failed,
    exhaustedObserved,
    skipped: false,
    workerId: workerPrefix,
    acquiredJobIds: jobs.map((j) => j.id),
    acquiredOwners: jobs.map((j) => j.workerOwner),
  };
}

class ConversationSheetSyncRecoveryService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  start() {
    if (this.timer || this.stopped || !conversationSheetSyncJobRepository.isEnabled()) return;
    this.timer = setInterval(() => {
      void this._tick();
    }, RECOVERY_INTERVAL_MS);
    void this._tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async _tick() {
    if (this.running) return;
    this.running = true;
    try {
      await runDueSheetSyncJobs();
    } catch (error) {
      console.error(`[SheetSyncRecovery] timer_failed reason=${error.message}`);
    } finally {
      this.running = false;
    }
  }
}

const conversationSheetSyncRecoveryService = new ConversationSheetSyncRecoveryService();
export default conversationSheetSyncRecoveryService;
export { WORKER_ID as EMAIL_SYNC_WORKER_ID };