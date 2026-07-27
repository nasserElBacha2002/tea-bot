#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config.js';
import { config } from '../src/config.js';
import conversationRepository from '../src/repositories/conversation.repository.js';
import conversationSessionRepository from '../src/repositories/conversation-session.repository.js';
import conversationClassificationRepository from '../src/repositories/conversation-classification.repository.js';
import classificationReconciliationService from '../src/services/conversationClassification/classificationReconciliation.service.js';
import conversationSheetSyncService from '../src/services/conversationSheetSync.service.js';
import { EXPORT_DISPLAY_FALLBACK } from '../src/services/conversationClassification/classification.constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    dryRun: !argv.includes('--apply'),
    limit: 100,
    minConfidence: 0.7,
    onlyUnclassified: argv.includes('--only-unclassified'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--from-date' && next) options.fromDate = next;
    if (arg === '--to-date' && next) options.toDate = next;
    if (arg === '--conversation-id' && next) options.conversationId = next;
    if (arg === '--flow-version' && next) options.flowVersion = next;
    if (arg === '--limit' && next) options.limit = Number(next);
    if (arg === '--min-confidence' && next) options.minConfidence = Number(next);
  }

  return options;
}

function isLegacySheetValue(value) {
  const text = String(value || '').trim();
  return !text || text === '—' || text === EXPORT_DISPLAY_FALLBACK;
}

async function main() {
  if (!config.conversationClassificationReconciliationEnabled && !process.argv.includes('--force')) {
    console.error('[Reconcile] blocked: set CONVERSATION_CLASSIFICATION_RECONCILIATION_ENABLED=true or pass --force');
    process.exit(2);
  }
  if (!conversationRepository.isEnabled()) {
    console.error('[Reconcile] conversation DB disabled');
    process.exit(2);
  }

  const options = parseArgs(process.argv.slice(2));
  const batchKey = `classification-reconcile-${new Date().toISOString().slice(0, 10)}`;
  const stats = {
    analyzed: 0,
    unchanged: 0,
    wouldClassify: 0,
    wouldUpdateSheet: 0,
    conflicts: 0,
    insufficientEvidence: 0,
    errors: 0,
    dryRun: options.dryRun,
  };
  const reviewRows = [];

  let conversationIds = [];
  if (options.conversationId) {
    conversationIds = [options.conversationId];
  } else if (options.onlyUnclassified) {
    conversationIds = await classificationReconciliationService.listUnclassifiedConversationIds(options);
  } else {
    const batch = await conversationRepository.listConversations({
      limit: options.limit,
      offset: 0,
      sort: 'started_at_desc',
    });
    conversationIds = batch.map((item) => item.id);
  }

  if (conversationClassificationRepository.isEnabled()) {
    await conversationClassificationRepository.createBatch({
      batchKey,
      mode: options.dryRun ? 'dry-run' : 'apply',
      status: 'running',
      summaryJson: { options, total: conversationIds.length },
    });
  }

  for (const conversationId of conversationIds.slice(0, options.limit)) {
    stats.analyzed += 1;
    try {
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation) continue;

      const dbSession = await conversationSessionRepository.findLatestByConversationId(conversationId);
      const session = classificationReconciliationService.buildSessionFromDbSession(conversation, dbSession);
      const resolution = await classificationReconciliationService.classifySessionForExport(
        session,
        conversationId,
        { persist: !options.dryRun },
      );

      const classification = resolution.classification;
      const hasEvidence = Boolean(classification?.primaryQuery) && classification.source !== 'fallback';
      if (!hasEvidence || (classification.confidence || 0) < options.minConfidence) {
        stats.insufficientEvidence += 1;
        reviewRows.push({
          conversationId,
          action: 'skip',
          reason: 'insufficient_evidence',
          confidence: classification?.confidence || 0,
          source: classification?.source || 'fallback',
        });
        continue;
      }

      if (classification.source === 'manual') {
        stats.conflicts += 1;
        reviewRows.push({ conversationId, action: 'skip', reason: 'manual_override' });
        continue;
      }

      stats.wouldClassify += 1;
      let sheetResult = { skipped: true, reason: 'dry_run' };
      if (!options.dryRun && config.conversationClassificationSheetUpdateEnabled) {
        sheetResult = await conversationSheetSyncService.syncClassificationForConversation(conversation, {
          dryRun: false,
        });
      } else if (config.conversationClassificationSheetUpdateEnabled) {
        sheetResult = await conversationSheetSyncService.syncClassificationForConversation(conversation, {
          dryRun: true,
        });
      }

      if (sheetResult.updated) stats.wouldUpdateSheet += 1;
      else stats.unchanged += 1;

      reviewRows.push({
        conversationId,
        action: options.dryRun ? 'would_update' : 'updated',
        primaryQuery: classification.primaryQuery,
        legacyPrimaryQuery: resolution.legacyClassification?.primaryQuery || EXPORT_DISPLAY_FALLBACK,
        confidence: classification.confidence,
        source: classification.source,
        matchedRule: classification.matchedRule,
        sheet: sheetResult,
      });
    } catch (error) {
      stats.errors += 1;
      reviewRows.push({ conversationId, action: 'error', reason: error.message });
    }
  }

  const outputDir = path.join(__dirname, '../data/reconciliation');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${batchKey}${options.dryRun ? '-dry-run' : '-apply'}.json`);
  await fs.writeFile(outputPath, JSON.stringify({ batchKey, stats, rows: reviewRows }, null, 2));

  if (conversationClassificationRepository.isEnabled()) {
    await conversationClassificationRepository.completeBatch(batchKey, stats);
  }

  console.log('[Reconcile] summary', JSON.stringify(stats));
  console.log(`[Reconcile] review_file=${outputPath}`);
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('[Reconcile] fatal', error.message);
  process.exit(1);
});
