#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import flowDocumentService from '../src/services/flow-document.service.js';
import { ensureConversationDbReady } from '../src/db/conversation-db-health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { flowKey: 'main-menu', file: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--flow-key') args.flowKey = argv[++i];
    else if (arg === '--file' || arg === '-f') args.file = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/import-flow-json-to-draft.js --file <path> [--flow-key main-menu]');
      process.exit(0);
    }
  }
  if (!args.file) {
    console.error('--file is required');
    process.exit(1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const ready = await ensureConversationDbReady();
  if (!ready.ok) {
    console.error(`DB unavailable: ${ready.message}`);
    process.exit(2);
  }

  const abs = path.isAbsolute(args.file) ? args.file : path.join(process.cwd(), args.file);
  const flow = JSON.parse(await fs.readFile(abs, 'utf8'));
  const draft = await flowDocumentService.importJsonToDraft(args.flowKey, flow);
  console.log(`Imported ${abs} into draft ${args.flowKey} (${draft.version}, ${draft.nodes.length} nodes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
