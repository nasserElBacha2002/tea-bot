#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config.js';
import googleSheetsService from '../src/services/googleSheets.service.js';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseBatchId(argv) {
  const idx = argv.indexOf('--batch-id');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return null;
}

async function main() {
  const batchId = parseBatchId(process.argv.slice(2));
  if (!batchId) {
    console.error('Usage: node scripts/rollback-conversation-classifications.js --batch-id <batch-key>');
    process.exit(2);
  }

  const filePath = path.join(
    __dirname,
    '../data/reconciliation',
    `${batchId}-apply.json`,
  );

  let payload;
  try {
    payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    console.error(`[Rollback] batch file not found: ${filePath}`);
    process.exit(2);
  }

  if (!googleSheetsService.isEnabled() || !googleSheetsService.hasRequiredConfig()) {
    console.error('[Rollback] Google Sheets unavailable');
    process.exit(2);
  }

  const dryRun = !process.argv.includes('--apply');
  const tabName = config.googleSheetsTabName;
  let restored = 0;
  let skipped = 0;

  for (const row of payload.rows || []) {
    const backup = row.sheet?.backup || row.previousValues;
    if (!backup || !row.sheet?.sheetRow) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      restored += 1;
      continue;
    }
    for (const [cell, value] of Object.entries(backup)) {
      await googleSheetsService.updateCell(tabName, cell, value);
    }
    restored += 1;
  }

  console.log('[Rollback] summary', JSON.stringify({ batchId, dryRun, restored, skipped }));
  process.exit(0);
}

main().catch((error) => {
  console.error('[Rollback] fatal', error.message);
  process.exit(1);
});
