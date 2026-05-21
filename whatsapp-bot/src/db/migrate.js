import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import dotenv from 'dotenv';
import { buildMssqlConfig, validateSqlServerEnv } from './connection-config.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

function splitSqlBatches(content) {
  return content
    .split(/^\s*GO\s*$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function main() {
  const { ok, missing } = validateSqlServerEnv();
  if (!ok) {
    console.error(`Faltan variables de entorno: ${missing.join(', ')}`);
    process.exit(1);
  }

  const appConfig = buildMssqlConfig();
  const dbName = appConfig.database;

  const masterPool = await sql.connect({ ...appConfig, database: 'master' });
  await masterPool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.databases WHERE name = N'${dbName.replace(/'/g, "''")}')
    BEGIN
      CREATE DATABASE [${dbName.replace(/\]/g, ']]')}];
    END
  `);
  await masterPool.close();

  const pool = await sql.connect(appConfig);

  try {
    await pool.request().query(`
      IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.schema_migrations (
          id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          filename NVARCHAR(255) NOT NULL UNIQUE,
          applied_at DATETIME2 NOT NULL CONSTRAINT DF_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
        );
      END
    `);

    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const check = await pool
        .request()
        .input('filename', sql.NVarChar(255), file)
        .query('SELECT 1 AS n FROM dbo.schema_migrations WHERE filename = @filename');

      if (check.recordset.length > 0) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }

      const sqlContent = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
      const batches = splitSqlBatches(sqlContent);

      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        for (const batch of batches) {
          await new sql.Request(transaction).query(batch);
        }
        await new sql.Request(transaction)
          .input('filename', sql.NVarChar(255), file)
          .query('INSERT INTO dbo.schema_migrations (filename) VALUES (@filename)');
        await transaction.commit();
        console.log(`applied ${file}`);
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    }

    console.log('Migrations complete.');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
