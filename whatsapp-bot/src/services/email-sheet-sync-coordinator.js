import { createHash } from 'node:crypto';
import conversationSheetSyncJobRepository from '../repositories/conversation-sheet-sync-job.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSheetSyncService from './conversationSheetSync.service.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import { config } from '../config.js';

export function emailPayloadHash(email) {
  return createHash('sha256').update(String(email || '').toLowerCase()).digest('hex').slice(0, 32);
}

export async function isEmailSyncFenceActive(job, ownerId) {
  if (!job?.id) return false;
  const current = await conversationSheetSyncJobRepository.findJobFence(job.id);
  if (!current) return false;
  if (current.jobGeneration !== job.jobGeneration) return false;
  if (current.payloadHash !== job.payloadHash) return false;
  if (ownerId && current.workerOwner !== ownerId) return false;
  if (current.status !== 'processing') return false;
  return true;
}

export async function reconcileEmailSheetFromSql(conversationId) {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation?.contactEmail) return { skipped: true, reason: 'no_email' };
  const hash = emailPayloadHash(conversation.contactEmail);
  const tabName = config.googleSheetsTabName;
  const exportRecord = conversationSheetExportRepository.isEnabled()
    ? await conversationSheetExportRepository.findLatestByConversationAndTab(conversationId, tabName)
    : null;
  if (!exportRecord?.sheetRowNumber) {
    return { skipped: true, reason: 'row_not_exported' };
  }
  return conversationSheetSyncService.syncEmailForConversation(conversation);
}

export async function runFencedEmailSync(job, ownerId) {
  const conversation = await conversationRepository.findById(job.conversationId);
  if (!conversation?.contactEmail) {
    return { result: 'completed', reason: 'no_email', sheet: null };
  }
  const liveHash = emailPayloadHash(conversation.contactEmail);
  if (liveHash !== job.payloadHash) {
    const reconciled = await reconcileEmailSheetFromSql(job.conversationId);
    return { result: 'reconciled', reason: 'payload_superseded', sheet: reconciled };
  }

  const sheet = await conversationSheetSyncService.syncEmailForConversation(conversation, {
    beforeWrite: async () => isEmailSyncFenceActive(job, ownerId),
  });

  if (sheet.reason === 'fence_rejected') {
    const reconciled = await reconcileEmailSheetFromSql(job.conversationId);
    return { result: 'reconciled', reason: 'stale_write_prevented', sheet: reconciled };
  }

  return { result: sheet.updated || sheet.reason === 'already_set' ? 'synced' : 'skipped', sheet };
}

export async function finalizeEmailSyncJob(job, ownerId, conversationEmail) {
  const payloadHash = emailPayloadHash(conversationEmail);
  const completed = await conversationSheetSyncJobRepository.markCompleted(job.id, {
    ownerId,
    jobGeneration: job.jobGeneration,
    payloadHash,
  });
  if (completed) return { status: 'completed', job: completed };
  const reconciled = await reconcileEmailSheetFromSql(job.conversationId);
  return { status: 'stale_finalization', reconciled };
}