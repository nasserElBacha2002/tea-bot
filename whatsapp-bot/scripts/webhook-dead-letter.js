/**
 * Operación de DEAD_LETTER. No borra filas.
 * Sin --execute solo imprime el procedimiento y no abre una conexión.
 *
 *   node scripts/webhook-dead-letter.js
 *   node scripts/webhook-dead-letter.js --execute list
 *   node scripts/webhook-dead-letter.js --execute requeue <id>
 */
import '../src/config.js';
import { isolatedTestDatabaseReason } from '../src/db/isolated-test-database.js';

const execute = process.argv.includes('--execute');
const args = process.argv.filter((arg) => arg !== '--execute').slice(2);
const command = args[0] || 'list';
const id = args[1] || '';

console.log([
  'Procedimiento:',
  '1. list consulta id, MessageSid, attempts, error_code y error_message. No cambia filas.',
  '2. La alerta inbound_dead_letter_alert sale cuando el intento agota el máximo.',
  '3. requeue <id> solo cambia DEAD_LETTER a FAILED y descuenta un attempt.',
  '4. Ese cambio no recupera el mensaje, no lo reprocesa y no lo ejecuta.',
  '5. Hace falta el próximo webhook de Twilio. Los efectos ya guardados se reutilizan por MessageSid.',
  '6. No hay borrado. Un id que no está en DEAD_LETTER no cambia.',
].join('\n'));

if (!execute) {
  console.log('\nBLOCKED: sin --execute no hay conexión.');
  process.exit(2);
}

const reason = isolatedTestDatabaseReason();
if (reason) {
  console.error(reason);
  console.error('No se abrió una conexión.');
  process.exit(2);
}

const { listDeadLetters, requeueDeadLetter } = await import('../src/monitoring/webhook-events.service.js');
if (command === 'list') {
  const rows = await listDeadLetters(50);
  console.log(JSON.stringify(rows.map((row) => ({
    id: row.id,
    messageId: row.providerMessageId,
    attempts: row.attempts,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    status: row.status,
  }))));
  process.exit(0);
}

if (command === 'requeue') {
  if (!id) {
    console.error('Falta el id de provider_webhook_events.');
    process.exit(2);
  }
  const result = await requeueDeadLetter(id);
  console.log(JSON.stringify(result));
  if (!result.stateChangedToFailed) process.exit(1);
  console.error('La fila quedó FAILED. El mensaje no se ejecutó y sigue exigiendo el webhook.');
  process.exit(2);
}

console.error(`Comando desconocido: ${command}`);
process.exit(2);
