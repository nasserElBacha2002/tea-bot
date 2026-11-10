/**
 * Prepara una base SQL aislada para TB-006. No se conecta salvo --execute,
 * y --execute solo sigue si el entorno ya cumple la confirmación de pruebas.
 *
 * Uso:
 *   node scripts/create-sql-test-database.js
 *   TB_SQL_TEST_CONFIRM=tea_bot_test DB_SERVER=localhost DB_NAME=tea_bot_test_local \
 *     node scripts/create-sql-test-database.js --execute
 */
import '../src/config.js';
import { isolatedTestDatabaseReason } from '../src/db/isolated-test-database.js';

const execute = process.argv.includes('--execute');
const configuredName = String(process.env.DB_NAME || '').trim().toLowerCase();
const name = /^tea_bot_test_[a-z0-9_]+$/.test(configuredName)
  ? configuredName
  : 'tea_bot_test_local';
const server = String(process.env.DB_SERVER || 'localhost');

const procedure = [
  '1. Crear la base en el SQL Server local. No usar tea-bot ni un servidor remoto.',
  `   CREATE DATABASE ${name};`,
  '2. Apuntar el entorno de prueba a esa base y confirmarlo:',
  '   DB_SERVER=localhost',
  `   DB_NAME=${name}`,
  '   TB_SQL_TEST_CONFIRM=tea_bot_test',
  '3. Aplicar migraciones forward-only, incluida 010_webhook_response_body.sql.',
  '4. Correr node scripts/tb006-preflight.js --execute',
  '5. Correr la suite desde whatsapp-bot. Las pruebas que escriben SQL siguen',
  '   saliendo antes de conectar si la confirmación no coincide.',
].join('\n');

if (!execute) {
  console.log(procedure);
  console.log('\nBLOCKED: este comando no crea la base ni abre una conexión. Repetilo con --execute cuando el entorno de prueba esté confirmado.');
  process.exit(2);
}

const reason = isolatedTestDatabaseReason();
if (reason) {
  console.error(reason);
  console.error(`Servidor visto: ${server}. DB_NAME actual: ${configuredName || '(vacío)'}.`);
  console.error('No se abrió una conexión.');
  process.exit(2);
}

console.error('BLOCKED: la creación de la base exige un login con permiso CREATE DATABASE.');
console.error('Este script no aplica migraciones ni abre el pool de la aplicación.');
console.log(procedure);
process.exit(2);
