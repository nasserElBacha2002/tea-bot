import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import flowLoader from '../utils/flow-loader.js';
import sessionService from '../services/session.service.js';
import flowEngine from '../services/flow-engine.service.js';

const TEST_USER = 'cli-user';

/**
 * Inicializa los servicios necesarios para que el playground funcione
 * igual que el entorno de producción (WhatsApp).
 */
async function initialize() {
  try {
    await flowLoader.load();
    await sessionService.loadSessions();
    
    console.log('\x1b[32m%s\x1b[0m', '--- WhatsApp Bot Playground (Fase 2) ---');
    console.log('Modo de prueba local activado.');
    console.log('Usando flujos en modo: \x1b[33mDRAFT\x1b[0m (permite probar sin publicar)');
    console.log(`Usuario de prueba: ${TEST_USER}`);
    console.log('Comandos especiales: exit, reset, session, flow\n');
  } catch (error) {
    console.error('Error durante la inicialización:', error.message);
    process.exit(1);
  }
}

/**
 * Ejecuta el loop interactivo de la terminal.
 */
async function main() {
  await initialize();

  const rl = readline.createInterface({ input, output });

  // 1. Manejo del Saludo Inicial (Si no hay sesión) en modo DRAFT
  let session = sessionService.getSession(TEST_USER);
  if (!session) {
    const result = await flowEngine.resolveIncomingMessage({ 
      userId: TEST_USER, 
      text: '', 
      flowMode: 'draft' 
    });
    console.log(`\x1b[36mBot:\x1b[0m ${result.reply}\n`);
  }

  while (true) {
    const userInput = await rl.question('\x1b[33mTú:\x1b[0m ');
    const cmd = userInput.trim().toLowerCase();

    // Comandos de Salida
    if (cmd === 'exit') {
      console.log('Saliendo del playground...');
      break;
    }

    // Comando: Resetear Sesión
    if (cmd === 'reset') {
      await sessionService.resetSession(TEST_USER);
      console.log('\x1b[35m[Sistema]: Sesión reiniciada.\x1b[0m');
      const result = await flowEngine.resolveIncomingMessage({ 
        userId: TEST_USER, 
        text: '', 
        flowMode: 'draft' 
      });
      console.log(`\x1b[36mBot:\x1b[0m ${result.reply}\n`);
      continue;
    }

    // Comando: Inspeccionar Sesión
    if (cmd === 'session') {
      const session = sessionService.getSession(TEST_USER);
      console.log('\x1b[35m[Sistema]: Sesión actual:\x1b[0m', JSON.stringify(session, null, 2));
      continue;
    }

    // Comando: Ver Estado del Flujo
    if (cmd === 'flow') {
      const session = sessionService.getSession(TEST_USER);
      console.log(`\x1b[35m[Sistema]: Flow: ${session?.flowId || 'none'} | Node: ${session?.currentNode || 'none'}\x1b[0m`);
      continue;
    }

    // Procesar mensaje normal a través del Flow Engine (Fase 2 - modo DRAFT)
    try {
      const result = await flowEngine.resolveIncomingMessage({ 
        userId: TEST_USER, 
        text: userInput, 
        flowMode: 'draft' 
      });
      console.log(`\x1b[36mBot:\x1b[0m ${result.reply}\n`);
    } catch (error) {
      console.error('\x1b[31mError procesando respuesta:\x1b[0m', error.message);
    }
  }

  rl.close();
}

main();
