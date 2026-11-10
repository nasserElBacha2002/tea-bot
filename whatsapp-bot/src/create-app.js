import express from 'express';
import { config, hasMetaCritical } from './config.js';
import { createCorsMiddleware } from './cors-middleware.js';
import webhookRouter from './routes/webhook.routes.js';
import twilioWebhookRouter from './routes/twilio-webhook.routes.js';
import authRouter from './routes/auth.routes.js';
import flowAdminRouter from './routes/flow-admin.routes.js';
import simulatorRouter from './routes/simulator.routes.js';
import conversationsRouter from './routes/conversations.routes.js';
import devConversationsRouter from './routes/dev-conversations.routes.js';
import flowManagementRouter from './routes/flow-management.routes.js';
import monitoringRouter from './routes/monitoring.routes.js';
import compositeFlowLoader from './loaders/composite-flow-loader.js';
import {
  rememberUrlencodedBody,
  twilioWebhookBodyError,
} from './middleware/verify-twilio-signature.js';

/**
 * Misma pila HTTP del proceso. No valida el entorno, no abre puerto
 * y no arranca workers.
 */
export function createApp() {
  const app = express();
  const JSON_BODY_LIMIT = process.env.EXPRESS_JSON_LIMIT ?? '2mb';

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({
    extended: false,
    limit: JSON_BODY_LIMIT,
    verify: rememberUrlencodedBody,
  }));
  app.use(createCorsMiddleware());

  app.use('/webhook', webhookRouter);
  app.use('/webhooks/twilio', twilioWebhookRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/flows', flowAdminRouter);
  app.use('/api/simulator', simulatorRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/dev/conversations', devConversationsRouter);
  app.use('/api/flow-management', flowManagementRouter);
  app.use('/api/monitoring', monitoringRouter);

  app.get('/', (req, res) => {
    res.json({
      ok: true,
      message: 'WhatsApp bot running',
    });
  });

  app.get('/health', (req, res) => {
    res.status(200).json({
      ok: true,
      service: 'whatsapp-bot',
      timestamp: new Date().toISOString(),
      environment: config.nodeEnv,
    });
  });

  app.get('/healthz', async (req, res) => {
    const timestamp = new Date().toISOString();
    let activePublishedFlow = false;
    try {
      const ids = await compositeFlowLoader.listPublishedFlowKeys();
      for (const flowId of ids) {
        try {
          const loaded = await compositeFlowLoader.loadActivePublished(flowId);
          if (loaded?.flow) {
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

  app.use(twilioWebhookBodyError);
  return app;
}
