#!/usr/bin/env node
/**
 * DIN-432 historical field sync — dry-run por defecto, lotes, checkpoint y rollback granular.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/config.js';
import { config } from '../config.js';
import conversationSheetSyncService from '../src/services/conversationSheetSync.service.js';
import conversationRepository from '../src/repositories/conversation.repository.js';
import googleSheetsService from '../src/services/googleSheets.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultStatePath = path.resolve(__dirname, '../../DIN-432/corrections-round-2/historical-sync-state.json');
const defaultBackupPath = path.resolve(__dirname, '../../DIN-432/corrections-round-2/historical-sync-backup.json');

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    resume: argv.includes('--resume'),
    rollback: argv.includes('--rollback'),
    batchSize: Number(argv.find((a, i) => argv[i - 1] === '--batch-size') || 50),
    statePath: argv.find((a, i) => argv[i - 1] === '--state') || defaultStatePath,
    backupPath: argv.find((a, i) => argv[i - 1] === '--backup') || defaultBackupPath,
    spreadsheetId: argv.find((a, i) => argv[i - 1] === '--spreadsheet-id') || config.googleSheetsSpreadsheetId,
  };
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function saveJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function assertAuthorizedDestination(options) {
  const expected = String(config.googleSheetsSpreadsheetId || '').trim();
  const target = String(options.spreadsheetId || '').trim();
  if (!expected || !target || expected !== target) {
    throw new Error(`destination_not_authorized expected=${expected} got=${target}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dryRun = !options.apply && !options.rollback;
  const stats = {
    dryRun,
    rollback: options.rollback,
    analyzed: 0,
    wouldUpdate: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
    offset: 0,
  };

  if (!conversationRepository.isEnabled()) {
    console.error('[HistoricalSync] conversation DB disabled');
    process.exit(2);
  }
  assertAuthorizedDestination(options);

  const state = await loadJson(options.statePath, { offset: 0, entries: [] });
  const backup = await loadJson(options.backupPath, { cells: [] });
  stats.offset = options.resume ? Number(state.offset || 0) : 0;

  if (options.rollback) {
    let rolledBack = 0;
    for (const entry of backup.cells || []) {
      const current = await googleSheetsService.readTabValues(config.googleSheetsTabName);
      const headers = current[0] || [];
      const col = headers.indexOf(entry.field);
      if (col < 0) continue;
      const row = current[entry.sheetRow];
      const liveValue = row?.[col];
      if (String(liveValue) !== String(entry.appliedValue)) {
        stats.skipped += 1;
        continue;
      }
      if (!dryRun) {
        await googleSheetsService.updateCell(config.googleSheetsTabName, `${String.fromCharCode(65 + col)}${entry.sheetRow}`, entry.previousValue);
      }
      rolledBack += 1;
    }
    stats.applied = rolledBack;
    await saveJson(options.statePath, { ...state, lastRollbackAt: new Date().toISOString(), rolledBack });
    console.log('[HistoricalSync] rollback summary', JSON.stringify(stats));
    return;
  }

  while (true) {
    const batch = await conversationRepository.listConversationsWithContactEmail({
      limit: options.batchSize,
      offset: stats.offset,
    });
    if (batch.length === 0) break;

    for (const conversation of batch) {
      stats.analyzed += 1;
      if (!conversation.id) {
        stats.skipped += 1;
        continue;
      }
      try {
        const result = await conversationSheetSyncService.syncEmailForConversation(conversation, { dryRun });
        if (result.dryRun && result.updated) {
          stats.wouldUpdate += 1;
          backup.cells.push({
            conversationId: conversation.id,
            sheetRow: result.sheetRow,
            field: 'Email',
            previousValue: '—',
            appliedValue: result.email,
          });
        } else if (!dryRun && result.updated) {
          stats.applied += 1;
          backup.cells.push({
            conversationId: conversation.id,
            sheetRow: result.sheetRow,
            field: 'Email',
            previousValue: result.previousValue || '—',
            appliedValue: result.email,
          });
        } else {
          stats.skipped += 1;
        }
      } catch (error) {
        stats.errors += 1;
        console.error(`[HistoricalSync] error conversationId=${conversation.id} reason=${error.message}`);
      }
    }

    stats.offset += batch.length;
    await saveJson(options.statePath, {
      offset: stats.offset,
      at: new Date().toISOString(),
      stats,
    });
    await saveJson(options.backupPath, backup);

    if (batch.length < options.batchSize) break;
  }

  console.log('[HistoricalSync] summary', JSON.stringify(stats));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});