#!/usr/bin/env node
/**
 * One-shot fix for servers stuck on invalid published main-menu v10:
 * 1) run migrations
 * 2) import v11.json into draft
 * 3) publish draft (becomes active published version)
 *
 * Usage (from repo root):
 *   docker compose run --rm whatsapp-bot node scripts/server-activate-main-menu-v11.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { runMigrations } from '../src/db/migration-runner.js';
import { ensureConversationDbReady } from '../src/db/conversation-db-health.js';
import flowDocumentService from '../src/services/flow-document.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V11_PATH = path.join(__dirname, '../data/flows/published/main-menu/v11.json');

async function main() {
  const ready = await ensureConversationDbReady();
  if (!ready.ok) {
    console.error(`DB unavailable: ${ready.message}`);
    process.exit(2);
  }

  try {
    await fs.access(V11_PATH);
  } catch {
    console.error(`Missing file: ${V11_PATH}`);
    console.error('Run git pull on the server or copy v11.json into data/flows/published/main-menu/');
    process.exit(1);
  }

  console.log('Running migrations…');
  const migrationResult = await runMigrations();
  console.log(
    `Migrations: applied=${migrationResult.appliedCount} skipped=${migrationResult.skippedCount}`,
  );

  const raw = await fs.readFile(V11_PATH, 'utf8');
  const flow = JSON.parse(raw);
  console.log(`Importing ${V11_PATH} (${flow.nodes?.length ?? 0} nodes) into draft…`);
  const draft = await flowDocumentService.importJsonToDraft('main-menu', flow);
  console.log(`Draft ready: ${draft.version} (${draft.nodes.length} nodes)`);

  console.log('Publishing draft…');
  const published = await flowDocumentService.publishDraft('main-menu');
  console.log(`✅ Active published version: ${published.version} (entryNode=${published.entryNode})`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
