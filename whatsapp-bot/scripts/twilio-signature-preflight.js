/**
 * Informe de la firma inbound. No abre sockets ni imprime el auth token.
 * Exit 0 solo cuando el modo efectivo es log y la configuración puede verificar
 * sin cortar el canal. off no es éxito. enforce no queda aprobado por este comando.
 */
import { assessTwilioSignatureReadiness } from '../src/config.js';

const report = assessTwilioSignatureReadiness();
console.log(JSON.stringify(report));

if (report.ready) {
  process.exit(0);
}

console.error(
  'TWILIO_SIGNATURE preflight: ready=false. off no es una activación. enforceReady permanece false.',
);
if (report.logDisruptive) {
  console.error(
    `log no es una activación inocua (${report.startupBlocking.join(', ')}). No se degrada a off.`,
  );
}
process.exit(2);
