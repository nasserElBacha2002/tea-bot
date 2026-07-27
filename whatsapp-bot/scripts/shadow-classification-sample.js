#!/usr/bin/env node
import '../src/config.js';
import { config } from '../src/config.js';
import conversationRepository from '../src/repositories/conversation.repository.js';
import conversationSessionRepository from '../src/repositories/conversation-session.repository.js';
import classificationReconciliationService from '../src/services/conversationClassification/classificationReconciliation.service.js';
import { EXPORT_DISPLAY_FALLBACK } from '../src/services/conversationClassification/classification.constants.js';

function parseLimit(argv) {
  const idx = argv.indexOf('--limit');
  if (idx >= 0 && argv[idx + 1]) return Number(argv[idx + 1]);
  return 25;
}

const limit = parseLimit(process.argv.slice(2));

if (config.conversationClassificationMode !== 'shadow') {
  console.warn(`[ShadowSample] CONVERSATION_CLASSIFICATION_MODE=${config.conversationClassificationMode} (expected shadow for baseline)`);
}

const conversations = await conversationRepository.listConversations({
  limit,
  offset: 0,
  sort: 'started_at_desc',
});

const stats = {
  analyzed: 0,
  shadowDiff: 0,
  v2Classified: 0,
  legacyFallback: 0,
  v2Fallback: 0,
  rows: [],
};

for (const conversation of conversations) {
  stats.analyzed += 1;
  const dbSession = await conversationSessionRepository.findLatestByConversationId(conversation.id);
  const session = classificationReconciliationService.buildSessionFromDbSession(conversation, dbSession);
  const resolution = await classificationReconciliationService.classifySessionForExport(
    session,
    conversation.id,
    { persist: true },
  );

  const legacy = resolution.legacyClassification?.primaryQuery || EXPORT_DISPLAY_FALLBACK;
  const v2 = resolution.classification?.primaryQuery || EXPORT_DISPLAY_FALLBACK;
  if (legacy === EXPORT_DISPLAY_FALLBACK || !resolution.legacyClassification?.primaryQuery) {
    stats.legacyFallback += 1;
  }
  if (v2 === EXPORT_DISPLAY_FALLBACK || !resolution.classification?.primaryQuery) {
    stats.v2Fallback += 1;
  } else {
    stats.v2Classified += 1;
  }
  if (resolution.shadowDiff) stats.shadowDiff += 1;

  stats.rows.push({
    conversationId: conversation.id,
    flowVersion: conversation.currentFlowVersion,
    legacy,
    v2,
    shadowDiff: resolution.shadowDiff,
    source: resolution.classification?.source,
    confidence: resolution.classification?.confidence,
    matchedRule: resolution.classification?.matchedRule,
    visitedNodes: session.visitedNodes?.slice(-5),
  });
}

console.log('[ShadowSample] summary', JSON.stringify({
  mode: config.conversationClassificationMode,
  analyzed: stats.analyzed,
  shadowDiff: stats.shadowDiff,
  v2Classified: stats.v2Classified,
  legacyFallback: stats.legacyFallback,
  v2Fallback: stats.v2Fallback,
  legacyFallbackRate: stats.analyzed ? (stats.legacyFallback / stats.analyzed).toFixed(2) : '0',
  v2FallbackRate: stats.analyzed ? (stats.v2Fallback / stats.analyzed).toFixed(2) : '0',
}, null, 2));

for (const row of stats.rows) {
  if (!row.shadowDiff) continue;
  console.log('[ShadowSample] diff', JSON.stringify(row));
}

process.exit(0);
