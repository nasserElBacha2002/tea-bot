/**
 * Preflight de TB-006.
 * Sin un modo no abre una conexión.
 * --execute sigue reservado a la base de prueba aislada y revierte su sonda.
 * --inspect solo lee el esquema. No escribe ni aplica migraciones.
 * --probe inserta y borra únicamente su fila sintética, con autorización aparte.
 * --apply-010 aplica solo 010_webhook_response_body.sql.
 * La confirmación productiva no entra en la allowlist de SQL TEST.
 */
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import sql from 'mssql';
import '../src/config.js';
import { isolatedTestDatabaseReason } from '../src/db/isolated-test-database.js';
import { splitSqlBatches } from '../src/db/migration-runner.js';
import { computeFlowChecksum } from '../src/utils/flow-checksum.js';

const migrationFile = '010_webhook_response_body.sql';
const historyFiles = [
  '001_conversations_phase1.sql',
  '002_human_handoffs.sql',
  '003_flows_schema.sql',
  '004_audit_logs.sql',
  '005_contact_email.sql',
  '006_conversation_classification.sql',
  '007_monitoring.sql',
  '008_conversation_reentry.sql',
];
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
const protectedTables = [
  'dbo.conversations',
  'dbo.conversation_messages',
  'dbo.conversation_sessions',
  'dbo.human_handoffs',
  'dbo.flow_versions',
];
const PROBE_BODY = '<Response><Message>tb006-probe</Message></Response>';
const APPLY_CONFIRM = '010_webhook_response_body.sql';
const PROBE_CONFIRM = 'TB006_PROBE';

export function resolveTb006Command(argv, env = process.env) {
  const selected = ['--inspect', '--probe', '--execute', '--apply-010']
    .filter((flag) => argv.includes(flag));
  if (selected.length !== 1) {
    return {
      ok: false,
      exitCode: 2,
      reason: selected.length === 0 ? 'mode_required' : 'mode_ambiguous',
    };
  }
  const mode = selected[0].replace(/^--/, '');
  const dbName = String(env.DB_NAME || '').trim();
  const production = dbName.length > 0 && String(env.TB006_PRODUCTION_CONFIRM || '') === dbName;
  const testReady = isolatedTestDatabaseReason(env) == null;

  if (mode === 'execute') {
    if (!testReady) {
      return { ok: false, exitCode: 2, mode, reason: isolatedTestDatabaseReason(env) };
    }
    return { ok: true, mode, production: false };
  }
  if (mode === 'inspect') {
    if (!production && !testReady) {
      return { ok: false, exitCode: 2, mode, reason: 'inspect_not_authorized' };
    }
    return { ok: true, mode, production };
  }
  if (mode === 'probe') {
    if (String(env.TB006_PROBE_CONFIRM || '') !== PROBE_CONFIRM) {
      return { ok: false, exitCode: 2, mode, reason: 'probe_not_authorized' };
    }
    if (!production && !testReady) {
      return { ok: false, exitCode: 2, mode, reason: 'probe_destination_not_authorized' };
    }
    return { ok: true, mode, production };
  }
  if (testReady && !production) return { ok: true, mode, production: false };
  if (production && String(env.TB006_APPLY_010 || '') === APPLY_CONFIRM) {
    return { ok: true, mode, production: true };
  }
  return { ok: false, exitCode: 2, mode, reason: 'apply_010_not_authorized' };
}

function refuse(reason) {
  console.error(reason);
  console.error('No se abrió una conexión.');
  process.exit(2);
}

function sameCounts(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

async function main() {
  const command = resolveTb006Command(process.argv);
  if (!command.ok) {
    if (command.reason === 'mode_required') {
      console.log('Modos: --inspect, --probe, --execute, --apply-010.');
      console.log('--execute permanece limitado a la base de prueba aislada.');
      console.log('Producción exige TB006_PRODUCTION_CONFIRM igual a DB_NAME.');
      console.log('Esa confirmación no habilita SQL TEST ni --execute.');
    }
    refuse(command.reason || 'mode_required');
  }

  const { query, withTransaction, getPool, closePool } = await import('../src/db/index.js');
  const identity = await query(
    `SELECT DB_NAME() AS database_name, @@SERVERNAME AS server_name,
            CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
            CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS product_version`,
  );
  const databaseName = identity.rows[0]?.database_name;
  const serverName = identity.rows[0]?.server_name || null;
  if (String(databaseName || '').toLowerCase() !== String(process.env.DB_NAME).trim().toLowerCase()) {
    console.error('DB_NAME no coincide con la base conectada.');
    await closePool();
    process.exit(2);
  }
  const expectedServer = String(process.env.TB006_EXPECT_SERVER || '').trim();
  if (expectedServer && serverName !== expectedServer) {
    console.error('@@SERVERNAME no coincide con TB006_EXPECT_SERVER.');
    await closePool();
    process.exit(2);
  }

  const links = await query('SELECT COUNT(*) AS total FROM sys.servers WHERE is_linked = 1');
  const linkedServers = Number(links.rows[0]?.total || 0);
  if (linkedServers > 0 && command.mode !== 'inspect') {
    console.error('Hay linked servers. No se continúa.');
    await closePool();
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
       ORDER BY filename`,
    );
    const applied = new Map(migrations.rows.map((row) => [row.filename, Boolean(row.success)]));
    const response = byName.get('response_body');
    const responseType = response?.type_name ? String(response.type_name).toLowerCase() : null;
    const history = Object.fromEntries(historyFiles.map((filename) => [
      filename,
      applied.get(filename) === true,
    ]));
    const schemaChanges = await query(
      `SELECT session_id, command
       FROM sys.dm_exec_requests
       WHERE command LIKE N'%ALTER%'
          OR command LIKE N'%CREATE%'
          OR command LIKE N'%DBCC%'`,
    );
    return {
      database: databaseName,
      instance: serverName,
      edition: identity.rows[0]?.edition || null,
      productVersion: identity.rows[0]?.product_version || null,
      server: process.env.DB_SERVER,
      port: Number(process.env.DB_PORT || 1433),
      linkedServers,
      table: columns.rows.length > 0,
      missingColumns: requiredColumns.filter((name) => !byName.has(name)),
      uniqueMessageIndex: indexes.rows.some(
        (row) => row.name === 'UQ_provider_webhook_events_message' && row.is_unique,
      ),
      responseBody: Boolean(response),
      responseBodyType: responseType,
      responseBodyLength: response?.max_length ?? null,
      history,
      historyCoherent: historyFiles.every((filename) => history[filename] === true),
      migration007: applied.get('007_monitoring.sql') === true,
      migration009: applied.get('009_conversation_status_version.sql') === true,
      migration010: applied.get('010_webhook_response_body.sql') === true,
      migrations: migrations.rows.map((row) => ({
        filename: row.filename,
        success: Boolean(row.success),
      })),
      checkConstraints: checks.rows.map((row) => row.name),
      schemaChangeRequests: schemaChanges.rows.length,
    };
  }

  async function protectedCounts() {
    const counts = {};
    for (const table of protectedTables) {
      const exists = await query('SELECT OBJECT_ID($1, N\'U\') AS id', [table]);
      if (!exists.rows[0]?.id) {
        counts[table] = null;
        continue;
      }
      const total = await query(`SELECT COUNT(*) AS total FROM ${table}`);
      counts[table] = Number(total.rows[0]?.total || 0);
    }
    return counts;
  }

  if (command.mode === 'apply-010') {
    const before = await schemaReport();
    if (
      !before.table
      || !before.historyCoherent
      || !before.migration007
      || !before.uniqueMessageIndex
      || before.missingColumns.length
      || before.schemaChangeRequests > 0
      || before.migration009
    ) {
      console.log(JSON.stringify({
        event: 'tb006_apply_010',
        applied: false,
        reason: before.migration009 ? 'migration_009_present' : (
          before.schemaChangeRequests > 0 ? 'schema_change_in_progress' : 'schema_incomplete'
        ),
        before,
      }));
      await closePool();
      process.exit(1);
    }
    if (before.migration010 && before.responseBody && before.responseBodyLength === -1 && before.responseBodyType === 'nvarchar') {
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
    const ok = after.migration010
      && after.responseBody
      && after.responseBodyType === 'nvarchar'
      && after.responseBodyLength === -1
      && after.migration009 === false;
    console.log(JSON.stringify({ event: 'tb006_apply_010', applied: ok, after }));
    await closePool();
    process.exit(ok ? 0 : 1);
  }

  const report = await schemaReport();
  const statusCompatible = report.checkConstraints.length === 0;
  const schemaReady = report.table
    && report.missingColumns.length === 0
    && report.uniqueMessageIndex
    && report.historyCoherent
    && report.migration007
    && report.migration010
    && report.responseBody
    && report.responseBodyType === 'nvarchar'
    && report.responseBodyLength === -1
    && statusCompatible
    && report.schemaChangeRequests === 0;

  if (command.mode === 'inspect') {
    console.log(JSON.stringify({
      event: 'tb006_inspect',
      ...report,
      statusesAccepted: requiredStatuses,
      statusCompatible,
      schemaReady,
      writes: 'none',
    }));
    await closePool();
    process.exit(schemaReady ? 0 : 1);
  }

  if (command.mode === 'probe') {
    if (!report.responseBody || report.responseBodyLength !== -1) {
      console.log(JSON.stringify({
        event: 'tb006_probe',
        ready: false,
        reason: 'response_body_missing',
        schemaReady,
      }));
      await closePool();
      process.exit(1);
    }
    const probeId = `TB006-PROBE-${crypto.randomUUID()}`;
    const beforeCounts = await protectedCounts();
    let twimlAccepted = false;
    let cleanupFailed = false;
    let removed = 0;
    try {
      await query(
        `INSERT INTO dbo.provider_webhook_events (
           provider, event_type, provider_message_id, status, attempts, response_body
         )
         VALUES (N'twilio', N'inbound', $1, N'PROCESSED', 1, $2)`,
        [probeId, PROBE_BODY],
      );
      const stored = await query(
        `SELECT response_body
         FROM dbo.provider_webhook_events
         WHERE provider = N'twilio'
           AND event_type = N'inbound'
           AND provider_message_id = $1`,
        [probeId],
      );
      twimlAccepted = stored.rows.length === 1 && stored.rows[0]?.response_body === PROBE_BODY;
    } catch (error) {
      console.error(`La sonda no se insertó: ${error.message}`);
      twimlAccepted = false;
    }
    const pool = await getPool();
    const deleted = await pool.request()
      .input('id', sql.NVarChar(128), probeId)
      .input('body', sql.NVarChar(sql.MAX), PROBE_BODY)
      .query(
        `DELETE FROM dbo.provider_webhook_events
         WHERE provider = N'twilio'
           AND event_type = N'inbound'
           AND provider_message_id = @id
           AND response_body = @body
           AND status = N'PROCESSED'`,
      );
    removed = Number(deleted.rowsAffected?.[0] || 0);
    const left = await query(
      `SELECT COUNT(*) AS total
       FROM dbo.provider_webhook_events
       WHERE provider_message_id = $1`,
      [probeId],
    );
    const probeLeft = Number(left.rows[0]?.total || 0);
    cleanupFailed = removed !== 1 || probeLeft !== 0;
    const afterCounts = await protectedCounts();
    const protectedUntouched = sameCounts(beforeCounts, afterCounts);
    const ready = schemaReady && twimlAccepted && !cleanupFailed && protectedUntouched;
    console.log(JSON.stringify({
      event: 'tb006_probe',
      database: report.database,
      instance: report.instance,
      probeId,
      twimlAccepted,
      removed,
      probeLeft,
      cleanupFailed,
      protectedUntouched,
      schemaReady,
      ready,
    }));
    await closePool();
    process.exit(ready ? 0 : 1);
  }

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

  const ready = schemaReady && twimlAccepted && probeLeft === 0;
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
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  main().catch(async (error) => {
    console.error(error.message);
    process.exit(1);
  });
}
