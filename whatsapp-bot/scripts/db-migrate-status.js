#!/usr/bin/env node
import dotenv from 'dotenv';
import sql from 'mssql';
import { buildMssqlConfig, validateSqlServerEnv } from '../src/db/connection-config.js';
import {
  ensureSchemaMigrationsTable,
  getAppliedMigrations,
  listMigrationFiles,
  MIGRATIONS_DIR,
} from '../src/db/migration-runner.js';

dotenv.config();

async function main() {
  const { ok, missing } = validateSqlServerEnv();
  if (!ok) {
    console.error(`Faltan variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const pool = await sql.connect(buildMssqlConfig());
  try {
    await ensureSchemaMigrationsTable(pool);
    const files = await listMigrationFiles();
    const applied = await getAppliedMigrations(pool);
    const byName = new Map(applied.map((r) => [r.filename, r]));

    console.log(`Migrations dir: ${MIGRATIONS_DIR}`);
    console.log(`Motor: SQL Server (mssql)`);
    console.log('');
    console.log('filename | status | checksum | executed_at');
    console.log('---------|--------|----------|------------');

    for (const file of files) {
      const row = byName.get(file);
      if (row) {
        const cs = row.checksum ? `${String(row.checksum).slice(0, 8)}…` : '(sin checksum)';
        console.log(
          `${file} | applied | ${cs} | ${row.executed_at?.toISOString?.() ?? row.executed_at}`,
        );
      } else {
        console.log(`${file} | pending | — | —`);
      }
    }

    const pending = files.filter((f) => !byName.has(f)).length;
    console.log('');
    console.log(`Total: ${files.length} archivos, ${applied.length} aplicadas, ${pending} pendientes`);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
