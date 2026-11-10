/**
 * Preflight de TB-006. Sin --execute no abre una conexión.
 * Con --execute solo lee el esquema de una base ya confirmada como TEST.
 */
import '../src/config.js';
import { isolatedTestDatabaseReason } from '../src/db/isolated-test-database.js';

const execute = process.argv.includes('--execute');

const checks = [
  'provider_webhook_events existe y el índice UQ_provider_webhook_events_message es único',
  'updated_at y attempts existen',
  'response_body existe (migración 010). Sin ella el replay de TwiML queda vacío',
  'MONITORING_ENABLED no participa de la adquisición',
];

if (!execute) {
  console.log('Orden de despliegue:');
  console.log('1. Base compatible, sin editar la migración 007.');
  console.log('2. Migraciones 001-010 verificadas. 010 es dependencia del replay, no de la exclusión.');
  console.log('3. Backend de esta entrega.');
  console.log('4. Suite, con las pruebas SQL contra tea_bot_test_<sufijo>.');
  console.log('5. Activar el proceso y mirar inbound_acquired, inbound_failed e inbound_dead_letter_alert.');
  console.log('');
  console.log('Chequeos de esquema:');
  for (const check of checks) console.log(`- ${check}`);
  console.log('\nBLOCKED: sin --execute no hay conexión.');
  process.exit(2);
}

const reason = isolatedTestDatabaseReason();
if (reason) {
  console.error(reason);
  console.error('No se abrió una conexión.');
  process.exit(2);
}

const { query } = await import('../src/db/index.js');
const index = await query(
  `SELECT is_unique
   FROM sys.indexes
   WHERE name = N'UQ_provider_webhook_events_message'`,
);
const column = await query(
  `SELECT c.max_length
   FROM sys.columns c
   WHERE c.object_id = OBJECT_ID(N'dbo.provider_webhook_events')
     AND c.name = N'response_body'`,
);
const ready = Boolean(index.rows[0]?.is_unique) && column.rows.length === 1;
console.log(JSON.stringify({
  event: 'tb006_preflight',
  uniqueIndex: Boolean(index.rows[0]?.is_unique),
  responseBody: column.rows.length === 1,
  responseBodyLength: column.rows[0]?.max_length ?? null,
  ready,
}));
process.exit(ready ? 0 : 1);
