#!/usr/bin/env node
/**
 * Repairs numeric/non-string transition values in a new published flow version.
 */
import 'dotenv/config';
import flowCatalogRepository from '../src/repositories/flow-catalog.repository.js';
import flowPublishDbService from '../src/services/flow-publish-db.service.js';
import flowDraftManagementService from '../src/services/flow-draft-management.service.js';
import { coerceTransitionValueForDocument } from '../src/utils/flow-transition-value.js';
import { ensureConversationDbReady } from '../src/db/conversation-db-health.js';

function parseArgs(argv) {
  const args = { flowKey: 'main-menu', fromVersion: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--flow-key') args.flowKey = argv[++i];
    else if (arg === '--from-version') args.fromVersion = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/repair-flow-text-fields.js --flow-key <key> --from-version <vN> [--dry-run]');
      process.exit(0);
    }
  }
  if (!args.fromVersion) {
    console.error('--from-version is required');
    process.exit(1);
  }
  return args;
}

async function repairTransitions(flowKey, versionLabel, transitions, { dryRun }) {
  let repaired = 0;
  const samples = [];
  for (const trans of transitions) {
    if (trans.value === undefined || trans.value === null) continue;
    let needsRepair = false;
    if (typeof trans.value === 'number' || typeof trans.value === 'boolean') needsRepair = true;
    else if (Array.isArray(trans.value)) needsRepair = trans.value.some((item) => typeof item !== 'string');
    else if (typeof trans.value !== 'string') needsRepair = true;
    if (!needsRepair) continue;

    const coerced = coerceTransitionValueForDocument(trans.value, {
      flowKey,
      version: versionLabel,
      nodeId: trans.sourceNodeKey,
      path: `nodes.${trans.sourceNodeKey}.transitions[].value`,
    });

    repaired += 1;
    if (samples.length < 5) {
      samples.push({
        node: trans.sourceNodeKey,
        type: trans.type,
        before: trans.value,
        after: coerced,
      });
    }
    if (!dryRun) {
      await flowCatalogRepository.updateTransition(trans.id, { value: coerced });
    }
  }
  return { repaired, samples };
}

async function main() {
  const args = parseArgs(process.argv);
  const ready = await ensureConversationDbReady();
  if (!ready.ok) {
    console.error(`DB unavailable: ${ready.message}`);
    process.exit(2);
  }

  const flowRow = await flowCatalogRepository.getFlowByKey(args.flowKey);
  if (!flowRow) {
    console.error(`Flow "${args.flowKey}" not found`);
    process.exit(1);
  }

  const versions = await flowCatalogRepository.listVersions(flowRow.id);
  const source = versions.find((v) => v.versionLabel === args.fromVersion);
  if (!source) {
    console.error(`Version "${args.fromVersion}" not found for "${args.flowKey}"`);
    process.exit(1);
  }

  const sourceGraph = await flowCatalogRepository.getVersionGraph(source.id);
  const preview = await repairTransitions(args.flowKey, source.versionLabel, sourceGraph.transitions, {
    dryRun: true,
  });
  console.log(`Transitions needing repair in ${args.fromVersion}: ${preview.repaired}`);
  for (const sample of preview.samples) {
    console.log(`- node ${sample.node} (${sample.type}): ${JSON.stringify(sample.before)} -> ${JSON.stringify(sample.after)}`);
  }

  if (args.dryRun || preview.repaired === 0) {
    return;
  }

  const existingDraft = await flowCatalogRepository.getLatestDraftVersion(flowRow.id);
  if (existingDraft) {
    await flowDraftManagementService.discardDraft(existingDraft.id);
  }

  const draft = await flowDraftManagementService.createDraftFromVersion(flowRow.id, source.id);
  const draftGraph = await flowCatalogRepository.getVersionGraph(draft.id);
  const applied = await repairTransitions(args.flowKey, draft.versionLabel, draftGraph.transitions, {
    dryRun: false,
  });
  console.log(`Repaired transitions in draft ${draft.versionLabel}: ${applied.repaired}`);

  const published = await flowPublishDbService.publishDraft(draft.id);
  console.log(
    `Published corrected version ${published.version.versionLabel} for "${args.flowKey}" (from ${args.fromVersion})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
