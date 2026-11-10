/**
 * Preflight de TB-006.
 * Sin flags no abre una conexión.
 * --execute lee el esquema y prueba el TwiML dentro de una transacción que revierte.
 * --apply-010 aplica solo 010_webhook_response_body.sql si la base confirmada
 * todavía no la tiene. No crea bases ni toca migraciones ya registradas.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from 'mssql';
import '../src/config.js';
import { isolatedTestDatabaseReason } from '../src/db/isolated-test-database.js';
import { splitSqlBatches } from '../src/db/migration-runner.js';
import { computeFlowChecksum } from '../src/utils/flow-checksum.js';

const execute = process.argv.includes('--execute');
const apply010 = process.argv.includes('--apply-010');
const migrationFile = '010_webhook_response_body.sql';
const requiredColumns = [
  'id',
  'provider',
  'event_type',
  'provider_message_id',
  'received_at',
  'processed_at',
  'status',
  'attempts',
  'error_code',
  'error_message',
  'payload_json',
  'updated_at',
];
const requiredStatuses = ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER'];

function refuse(reason) {
  console.error(reason);
  console.error('No se abrió una conexión.');
  process.exit(2);
}

if (!execute && !apply010) {
  console.log('Orden de despliegue:');
  console.log('1. Base compatible, sin editar la migración 007.');
  console.log('2. Migraciones 001-008 y 010 verificadas. 009 no es requisito con el takeover apagado.');
  console.log('3. 010 es dependencia del replay de TwiML, no de la exclusión.');
  console.log('4. Backend de esta entrega.');
  console.log('5. Suite contra la base local confirmada.');
  console.log('6. Activar el proceso y mirar inbound_acquired, inbound_failed e inbound_dead_letter_alert.');
  console.log('\nBLOCKED: sin --execute ni --apply-010 no hay conexión.');
  process.exit(2);
}

const reason = isolatedTestDatabaseReason();
if (reason) refuse(reason);

const { query, withTransaction, getPool, closePool } = await import('../src/db/index.js');

const identity = await query(
  `SELECT DB_NAME() AS database_name, @@SERVERNAME AS server_name`,
);
const databaseName = identity.rows[0]?.database_name;
if (String(databaseName || '').toLowerCase() !== String(process.env.DB_NAME).trim().toLowerCase()) {
  console.error('DB_NAME no coincide con la base conectada.');
  process.exit(2);
}

const links = await query('SELECT COUNT(*) AS total FROM sys.servers WHERE is_linked = 1');
if (Number(links.rows[0]?.total || 0) > 0) {
  console.error('Hay linked servers. No se continúa.');
  process.exit(2);
}

async function schemaReport() {
  const columns = await query(
    `SELECT c.name, c.max_length, TYPE_NAME(c.user_type_id) AS type_name
     FROM sys.columns c
     WHERE c.object_id = OBJECT_ID(N'dbo.provider_webhook_events')`,
  );
  const byName = new Map(columns.rows.map((row) => [row.name, row]));
  const indexes = await query(
    `SELECT name, is_unique
     FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.provider_webhook_events')`,
  );
  const checks = await query(
    `SELECT name, definition
     FROM sys.check_constraints
     WHERE parent_object_id = OBJECT_ID(N'dbo.provider_webhook_events')`,
  );
  const migrations = await query(
    `SELECT filename, success
     FROM dbo.schema_migrations
     WHERE filename IN (
       N'007_monitoring.sql', N'009_conversation_status_version.sql', N'010_webhook_response_body.sql'
     )`,
  );
  const applied = new Map(migrations.rows.map((row) => [row.filename, Boolean(row.success)]));
  const response = byName.get('response_body');
  return {
    database: databaseName,
    instance: identity.rows[0]?.server_name || null,
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    table: columns.rows.length > 0,
    missingColumns: requiredColumns.filter((name) => !byName.has(name)),
    uniqueMessageIndex: indexes.rows.some(
      (row) => row.name === 'UQ_provider_webhook_events_message' && row.is_unique,
    ),
    responseBody: Boolean(response),
    responseBodyType: response?.type_name || null,
    responseBodyLength: response?.max_length ?? null,
    migration007: applied.get('007_monitoring.sql') === true,
    migration009: applied.get('009_conversation_status_version.sql') === true,
    migration010: applied.get('010_webhook_response_body.sql') === true,
    checkConstraints: checks.rows.map((row) => row.name),
  };
}

if (apply010) {
  const before = await schemaReport();
  if (!before.table || !before.migration007 || !before.uniqueMessageIndex || before.missingColumns.length) {
    console.log(JSON.stringify({ event: 'tb006_apply_010', applied: false, reason: 'schema_incomplete', before }));
    await closePool();
    process.exit(1);
  }
  if (before.migration010 && before.responseBody && before.responseBodyLength === -1) {
    console.log(JSON.stringify({ event: 'tb006_apply_010', applied: false, reason: 'already_applied', before }));
    await closePool();
    process.exit(0);
  }
  if (before.migration010 !== before.responseBody) {
    console.log(JSON.stringify({ event: 'tb006_apply_010', applied: false, reason: 'schema_mismatch', before }));
    await closePool();
    process.exit(1);
  }
  const fullPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations', migrationFile);
  const content = fs.readFileSync(fullPath, 'utf8');
  const checksum = computeFlowChecksum(content);
  const batches = splitSqlBatches(content);
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const batch of batches) {
      await new sql.Request(transaction).query(batch);
    }
    await new sql.Request(transaction)
      .input('filename', sql.NVarChar(255), migrationFile)
      .input('checksum', sql.NVarChar(64), checksum)
      .query(
        `INSERT INTO dbo.schema_migrations (filename, checksum, success)
         VALUES (@filename, @checksum, 1)`,
      );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    console.error(`010 no se aplicó: ${error.message}`);
    await closePool();
    process.exit(1);
  }
  const after = await schemaReport();
  const ok = after.migration010 && after.responseBody && after.responseBodyLength === -1;
  console.log(JSON.stringify({ event: 'tb006_apply_010', applied: ok, after }));
  await closePool();
  process.exit(ok ? 0 : 1);
}

const report = await schemaReport();
let twimlAccepted = false;
let probeLeft = null;
if (report.responseBody) {
  const probeId = `TB006-PREFLIGHT-${Date.now()}`;
  try {
    await withTransaction(async (transaction) => {
      await query(
        `INSERT INTO dbo.provider_webhook_events (
           provider, event_type, provider_message_id, status, attempts, response_body
         )
         VALUES (N'twilio', N'inbound', $1, N'PROCESSED', 1, $2)`,
        [probeId, '<Response><Message>preflight</Message></Response>'],
        { transaction },
      );
      const stored = await query(
        `SELECT response_body
         FROM dbo.provider_webhook_events
         WHERE provider_message_id = $1`,
        [probeId],
        { transaction },
      );
      twimlAccepted = stored.rows[0]?.response_body === '<Response><Message>preflight</Message></Response>';
      throw new Error('ROLLBACK_PROBE');
    });
  } catch (error) {
    if (error.message !== 'ROLLBACK_PROBE') {
      console.error(`La prueba de TwiML falló: ${error.message}`);
      await closePool();
      process.exit(1);
    }
  }
  const left = await query(
    `SELECT COUNT(*) AS total
     FROM dbo.provider_webhook_events
     WHERE provider_message_id = $1`,
    [probeId],
  );
  probeLeft = Number(left.rows[0]?.total || 0);
}

const statusCompatible = report.checkConstraints.length === 0;
const ready = report.table
  && report.missingColumns.length === 0
  && report.uniqueMessageIndex
  && report.migration007
  && report.migration010
  && report.responseBody
  && report.responseBodyLength === -1
  && twimlAccepted
  && probeLeft === 0
  && statusCompatible;

console.log(JSON.stringify({
  event: 'tb006_preflight',
  ...report,
  statusesAccepted: requiredStatuses,
  statusCompatible,
  twimlAccepted,
  probeLeft,
  takeoverMigrationRequired: false,
  ready,
}));
await closePool();
process.exit(ready ? 0 : 1);
