#!/usr/bin/env node
import dotenv from 'dotenv';
import { runMigrations } from '../src/db/migration-runner.js';

dotenv.config();

async function main() {
  const { log } = await runMigrations({ dryRun: true });
  for (const entry of log) {
    console.log(`${entry.action}: ${entry.file}`);
  }
  console.log('Dry-run complete (sin cambios en DB).');
}

main().catch((err) => {
  console.error('Dry-run failed:', err.message);
  process.exit(1);
});
