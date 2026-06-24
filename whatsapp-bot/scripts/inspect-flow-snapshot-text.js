#!/usr/bin/env node
/**
 * Read-only diagnostic: inspect published flow snapshots for invalid text/value fields.
 *
 * Usage:
 *   node scripts/inspect-flow-snapshot-text.js
 *   node scripts/inspect-flow-snapshot-text.js --flow-key main-menu --version v10
 *   node scripts/inspect-flow-snapshot-text.js --all-published
 */
import 'dotenv/config';
import flowDbRepository from '../src/repositories/flow-db.repository.js';
import {
  inspectFlowTextFields,
  formatFlowTextFieldIssue,
} from '../src/utils/flow-text-field-inspector.js';
import { compileFlow } from '../src/utils/compile-flow.js';
import { ensureConversationDbReady } from '../src/db/conversation-db-health.js';

function parseArgs(argv) {
  const args = {
    flowKey: 'main-menu',
    version: null,
    allPublished: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--flow-key') {
      args.flowKey = argv[++i];
    } else if (arg === '--version') {
      args.version = argv[++i];
    } else if (arg === '--all-published') {
      args.allPublished = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/inspect-flow-snapshot-text.js [--flow-key <key>] [--version <vN>] [--all-published]`);
      process.exit(0);
    }
  }
  return args;
}

function parseSnapshot(snapshotJson) {
  return typeof snapshotJson === 'string' ? JSON.parse(snapshotJson) : snapshotJson;
}

async function inspectSnapshot(flowKey, row) {
  const version = row.versionLabel || row.version;
  const flow = parseSnapshot(row.snapshotJson);
  const issues = inspectFlowTextFields(flow, { flowKey, version });
  let compileError = null;
  try {
    compileFlow(flow);
  } catch (err) {
    compileError = err.message;
  }
  return { flowKey, version, issues, compileError };
}

async function main() {
  const args = parseArgs(process.argv);
  const ready = await ensureConversationDbReady();
  if (!ready.ok) {
    console.error(`DB unavailable: ${ready.message}`);
    process.exit(2);
  }
  if (!flowDbRepository.isEnabled()) {
    console.error('Flow DB repository is not enabled.');
    process.exit(2);
  }

  /** @type {Array<{ flowKey: string, version: string }>} */
  const targets = [];

  if (args.allPublished) {
    const flowKeys = await flowDbRepository.listPublishedFlowKeys();
    for (const flowKey of flowKeys) {
      const latest = await flowDbRepository.getLatestPublishedSnapshot(flowKey);
      if (latest) targets.push({ flowKey, version: latest.versionLabel });
    }
  } else if (args.version) {
    targets.push({ flowKey: args.flowKey, version: args.version });
  } else {
    const latest = await flowDbRepository.getLatestPublishedSnapshot(args.flowKey);
    if (!latest) {
      console.error(`No published snapshot for "${args.flowKey}"`);
      process.exit(1);
    }
    targets.push({ flowKey: args.flowKey, version: latest.versionLabel });
  }

  let totalIssues = 0;
  let hasCompileErrors = false;

  for (const target of targets) {
    const row = target.version
      ? await flowDbRepository.getPublishedSnapshotByLabel(target.flowKey, target.version)
      : await flowDbRepository.getLatestPublishedSnapshot(target.flowKey);
    if (!row) {
      console.log(`[${target.flowKey} ${target.version}] snapshot not found`);
      continue;
    }

    const result = await inspectSnapshot(target.flowKey, row);
    console.log(`\n=== ${result.flowKey} ${result.version} ===`);
    if (result.issues.length === 0 && !result.compileError) {
      console.log('OK: no invalid text/value fields detected.');
      continue;
    }

    for (const issue of result.issues) {
      totalIssues += 1;
      console.log(`- ${formatFlowTextFieldIssue(issue)}`);
      if (issue.value !== undefined) {
        console.log(`  value: ${JSON.stringify(issue.value)}`);
      }
    }

    if (result.compileError) {
      hasCompileErrors = true;
      console.log(`- compile error: ${result.compileError}`);
    }
  }

  if (totalIssues > 0 || hasCompileErrors) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
