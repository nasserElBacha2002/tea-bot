#!/usr/bin/env node
import dotenv from 'dotenv';
import flowImportService from '../src/services/flow-import.service.js';
import { getFlowStorageMode } from '../src/config/flow-storage.js';

dotenv.config();

async function main() {
  console.log(`FLOW_STORAGE_MODE=${getFlowStorageMode()} (import siempre escribe en DB)`);
  const summary = await flowImportService.importAllFromDisk();
  console.log('Importación completada.');
  for (const p of summary.published) {
    const skipped = p.results?.filter((r) => r.skipped).length ?? 0;
    const updated = p.results?.filter((r) => !r.skipped).length ?? 0;
    console.log(`  published/${p.flowKey}: ${updated} actualizadas, ${skipped} sin cambios (checksum)`);
  }
  for (const d of summary.drafts) {
    console.log(`  draft/${d.flowKey}: ${d.skipped ? 'sin cambios' : 'importado'} (${d.versionLabel})`);
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
