import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import { computeFlowChecksum } from '../utils/flow-checksum.js';
import { buildMssqlConfig, validateSqlServerEnv } from './connection-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

export function splitSqlBatches(content) {
  return content
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

export async function ensureDatabaseExists(appConfig) {
  const dbName = appConfig.database;
  const masterPool = await sql.connect({ ...appConfig, database: 'master' });
  await masterPool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'${dbName.replace(/'/g, "''")}')
    BEGIN
      CREATE DATABASE [${dbName.replace(/\]/g, ']]')}];
    END
  `);
  await masterPool.close();
}

export async function ensureSchemaMigrationsTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.schema_migrations (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        filename NVARCHAR(255) NOT NULL UNIQUE,
        checksum NVARCHAR(64) NULL,
        executed_at DATETIME2 NOT NULL CONSTRAINT DF_schema_migrations_executed_at DEFAULT SYSUTCDATETIME(),
        success BIT NOT NULL CONSTRAINT DF_schema_migrations_success DEFAULT 1
      );
    END
    ELSE
    BEGIN
      IF COL_LENGTH('dbo.schema_migrations', 'checksum') IS NULL
        ALTER TABLE dbo.schema_migrations ADD checksum NVARCHAR(64) NULL;
      IF COL_LENGTH('dbo.schema_migrations', 'success') IS NULL
        ALTER TABLE dbo.schema_migrations ADD success BIT NOT NULL CONSTRAINT DF_schema_migrations_success DEFAULT 1;
    END
  `);
}

export async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

async function readMigrationFile(filename) {
  if (!filename.endsWith('.sql') || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Nombre de migración inválido: ${filename}`);
  }
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(MIGRATIONS_DIR))) {
    throw new Error(`Migración fuera de carpeta permitida: ${filename}`);
  }
  const content = await fs.readFile(resolved, 'utf-8');
  return { content, checksum: computeFlowChecksum(content) };
}

export async function getAppliedMigrations(pool) {
  await ensureSchemaMigrationsTable(pool);
  const { recordset } = await pool.request().query(
    'SELECT filename, checksum, executed_at, success FROM dbo.schema_migrations ORDER BY filename',
  );
  return recordset;
}

/**
 * @param {{ dryRun?: boolean, pool?: import('mssql').ConnectionPool }} opts
 */
export async function runMigrations(opts = {}) {
  const { ok, missing } = validateSqlServerEnv();
  if (!ok) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }

  const appConfig = buildMssqlConfig();
  const ownPool = !opts.pool;
  const pool = opts.pool || (await sql.connect(appConfig));

  if (ownPool) {
    await ensureDatabaseExists(appConfig);
  }

  await ensureSchemaMigrationsTable(pool);

  const files = await listMigrationFiles();
  const applied = await getAppliedMigrations(pool);
  const byName = new Map(applied.map((r) => [r.filename, r]));

  const log = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const { content, checksum } = await readMigrationFile(file);
    const existing = byName.get(file);

    if (existing) {
      if (existing.checksum && existing.checksum !== checksum) {
        throw new Error(
          `La migración "${file}" ya fue ejecutada pero el checksum cambió. No se aplicará automáticamente.`,
        );
      }
      if (!existing.checksum) {
        if (!opts.dryRun) {
          await pool
            .request()
            .input('filename', sql.NVarChar(255), file)
            .input('checksum', sql.NVarChar(64), checksum)
            .query(
              'UPDATE dbo.schema_migrations SET checksum = @checksum WHERE filename = @filename',
            );
        }
        log.push({ file, action: 'backfill-checksum' });
      } else {
        log.push({ file, action: 'skip' });
      }
      skippedCount += 1;
      continue;
    }

    if (opts.dryRun) {
      log.push({ file, action: 'would-apply' });
      continue;
    }

    const batches = splitSqlBatches(content);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const batch of batches) {
        await new sql.Request(transaction).query(batch);
      }
      await new sql.Request(transaction)
        .input('filename', sql.NVarChar(255), file)
        .input('checksum', sql.NVarChar(64), checksum)
        .query(
          `INSERT INTO dbo.schema_migrations (filename, checksum, success)
           VALUES (@filename, @checksum, 1)`,
        );
      await transaction.commit();
      log.push({ file, action: 'applied' });
      appliedCount += 1;
    } catch (err) {
      await transaction.rollback();
      throw new Error(`Error aplicando "${file}": ${err.message}`);
    }
  }

  if (ownPool) {
    await pool.close();
  }

  return { log, appliedCount, skippedCount, dryRun: Boolean(opts.dryRun) };
}
