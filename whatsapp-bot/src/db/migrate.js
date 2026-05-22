#!/usr/bin/env node
import dotenv from 'dotenv';
import { runMigrations } from './migration-runner.js';

dotenv.config();

async function main() {
  const { log, appliedCount, skippedCount } = await runMigrations();
  for (const entry of log) {
    if (entry.action === 'applied') console.log(`applied ${entry.file}`);
    else if (entry.action === 'skip') console.log(`skip ${entry.file} (already applied)`);
    else if (entry.action === 'backfill-checksum') console.log(`checksum backfill ${entry.file}`);
  }
  console.log(`Migrations complete. applied=${appliedCount} skipped=${skippedCount}`);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
