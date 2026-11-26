import http from 'http';
import { config, validateConfig } from './config.js';
import { createApp } from './create-app.js';
import monitoringService from './monitoring/monitoring.service.js';
import flowLoader from './utils/flow-loader.js';
import { getFlowStorageMode } from './config/flow-storage.js';
import sessionService from './services/session.service.js';
import conversationAbandonmentService from './services/conversationAbandonment.service.js';
import conversationRetentionService from './services/conversationRetention.service.js';
import whatsappBillingAggregateService from './services/whatsapp-billing-aggregate.service.js';
import whatsappBillingSyncService from './services/whatsapp-billing-sync.service.js';
import conversationSheetSyncRecoveryService from './services/conversation-sheet-sync-recovery.service.js';
import inboundMediaFetchService from './services/inbound-media-fetch.service.js';
import {
  installProcessShutdownHandlers,
  registerShutdownTask,
} from './process/shutdown-coordinator.js';
import flowDocumentService from './services/flow-document.service.js';
import { isConversationDbEnabled, pingDatabase } from './db/index.js';
import { probeReentryColumn } from './services/conversation-reentry.service.js';
import { attachConversationLiveWebSocket } from './realtime/conversation-live.ws.js';

const app = createApp();
const httpServer = http.createServer(app);

validateConfig();

installProcessShutdownHandlers();
registerShutdownTask('conversation_retention', () => conversationRetentionService.stop());
registerShutdownTask('billing_aggregate', () => whatsappBillingAggregateService.stop());
registerShutdownTask('billing_twilio_sync', () => whatsappBillingSyncService.stop());
registerShutdownTask('conversation_sheet_sync_recovery', () => conversationSheetSyncRecoveryService.stop());
registerShutdownTask('conversation_abandonment', () => conversationAbandonmentService.stop());
registerShutdownTask('inbound_media_fetch', () => inboundMediaFetchService.stop());
registerShutdownTask('monitoring', () => monitoringService.stop());
registerShutdownTask('http_server', () => new Promise((resolve) => {
  if (!httpServer.listening) {
    resolve();
    return;
  }
  httpServer.close(() => resolve());
}));

(async () => {
  try {
    await flowDocumentService.ensureStructure();

    console.log(`📦 FLOW_STORAGE_MODE=${getFlowStorageMode()}`);
    await flowLoader.load();

    await sessionService.loadSessions();
    conversationAbandonmentService.start();
    conversationRetentionService.start();
    whatsappBillingAggregateService.start();
    whatsappBillingSyncService.start();
    conversationSheetSyncRecoveryService.start();
    inboundMediaFetchService.start();
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
