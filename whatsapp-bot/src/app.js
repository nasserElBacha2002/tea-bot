import http from 'http';
import { config, validateConfig } from './config.js';
import { createApp } from './create-app.js';
import monitoringService from './monitoring/monitoring.service.js';
import flowLoader from './utils/flow-loader.js';
import { getFlowStorageMode } from './config/flow-storage.js';
import sessionService from './services/session.service.js';
import conversationAbandonmentService from './services/conversationAbandonment.service.js';
import conversationRetentionService from './services/conversationRetention.service.js';
import flowDocumentService from './services/flow-document.service.js';
import { isConversationDbEnabled, pingDatabase } from './db/index.js';
import { probeReentryColumn } from './services/conversation-reentry.service.js';
import { attachConversationLiveWebSocket } from './realtime/conversation-live.ws.js';

const app = createApp();
const httpServer = http.createServer(app);

validateConfig();

(async () => {
  try {
    await flowDocumentService.ensureStructure();

    console.log(`📦 FLOW_STORAGE_MODE=${getFlowStorageMode()}`);
    await flowLoader.load();

    await sessionService.loadSessions();
    conversationAbandonmentService.start();
    conversationRetentionService.start();
    monitoringService.start();

    if (isConversationDbEnabled()) {
      try {
        const dbPing = await pingDatabase();
        if (dbPing.ok) {
          console.log('🗄️  Persistencia de conversaciones (SQL Server) conectada.');
          await probeReentryColumn();
        } else {
          console.warn('⚠️ CONVERSATION_DB_ENABLED pero la base no respondió al ping.');
        }
      } catch (dbErr) {
        console.warn(
          `⚠️ CONVERSATION_DB_ENABLED pero falló la conexión: ${dbErr.message}`,
        );
      }
    }

    console.log('🚀 Sistema de flujos (Fase 3) y sesiones inicializado.');
  } catch (err) {
    console.error('❌ Error crítico en la inicialización:', err.message);
    process.exit(1);
  }
})();

attachConversationLiveWebSocket(httpServer);

httpServer.listen(config.port, () => {
  console.log(`🚀 El servidor de WhatsApp bot se levantó correctamente.`);
  console.log(`🌐 Local: http://localhost:${config.port}`);
  console.log(`🔗 Webhook endpoint: ${config.appBaseUrl}/webhook`);
  console.log(`📡 Conversaciones live: ws://localhost:${config.port}/api/conversations/live`);
});
