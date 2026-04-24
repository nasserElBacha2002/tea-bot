import express from 'express';
import { config, validateConfig, hasMetaCritical } from './config.js';
import { createCorsMiddleware } from './cors-middleware.js';
import webhookRouter from './routes/webhook.routes.js';
import twilioWebhookRouter from './routes/twilio-webhook.routes.js';
import authRouter from './routes/auth.routes.js';
import flowAdminRouter from './routes/flow-admin.routes.js';
import simulatorRouter from './routes/simulator.routes.js';
import flowLoader from './utils/flow-loader.js';
import sessionService from './services/session.service.js';
import { bootstrapFlows } from './utils/bootstrap-flows.js';
import flowRepository from './repositories/flow.repository.js';

const app = express();

// Middleware para procesar JSON y habilitar CORS
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(createCorsMiddleware());

// Verificación inicial de configuración
validateConfig();

// Carga inicial de flujos y sesiones
(async () => {
  try {
    // 1. Asegurar estructura y migrar flujos heredados si es necesario
    await flowRepository.ensureStructure();
    await bootstrapFlows();

    // 2. Cargar flujos publicados en el runtime
    await flowLoader.load();

    // 3. Cargar sesiones
    await sessionService.loadSessions();

    console.log('🚀 Sistema de flujos (Fase 3) y sesiones inicializado.');
  } catch (err) {
    console.error('❌ Error crítico en la inicialización:', err.message);
    process.exit(1);
  }
})();

// Rutas de la API
app.use('/webhook', webhookRouter);
app.use('/webhooks/twilio', twilioWebhookRouter);
app.use('/api/auth', authRouter);
app.use('/api/flows', flowAdminRouter);
app.use('/api/simulator', simulatorRouter);

/**
 * Health check endpoint.
 */
app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'WhatsApp bot running',
  });
});

/**
 * Health ligero para balanceadores y Docker (sin secretos).
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'whatsapp-bot',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

/**
 * Health extendido: sin llamadas a Meta ni lectura de secretos.
 */
app.get('/healthz', async (req, res) => {
  const timestamp = new Date().toISOString();
  let activePublishedFlow = false;
  try {
    const ids = await flowRepository.listPublishedFlows();
    for (const flowId of ids) {
      try {
        const meta = await flowRepository.getPublishedMetadata(flowId);
        if (!meta?.activeVersion) continue;
        const flow = await flowRepository.getLatestPublished(flowId);
        if (flow) {
          activePublishedFlow = true;
          break;
        }
      } catch {
        continue;
      }
    }
  } catch {
    activePublishedFlow = false;
  }

  res.status(200).json({
    ok: true,
    timestamp,
    meta: {
      verifyTokenConfigured: Boolean(process.env.META_VERIFY_TOKEN),
      accessTokenConfigured: Boolean(process.env.META_ACCESS_TOKEN),
      phoneNumberIdConfigured: Boolean(process.env.META_PHONE_NUMBER_ID),
      criticalMetaPresent: hasMetaCritical(),
    },
    activePublishedFlow,
    nodeEnv: config.nodeEnv,
  });
});

// Iniciamos el servidor
app.listen(config.port, () => {
  console.log(`🚀 El servidor de WhatsApp bot se levantó correctamente.`);
  console.log(`🌐 Local: http://localhost:${config.port}`);
  console.log(`🔗 Webhook endpoint: ${config.appBaseUrl}/webhook`);
});
