import { config } from '../config.js';
import flowEngine from '../services/flow-engine.service.js';
import webhookDedupe from '../services/webhook-dedupe.service.js';
import { sendTextMessage } from '../services/whatsapp.service.js';
import { createPerfContext, logPerf, maskId, nowMs, roundMs } from '../utils/perf-timer.js';

/**
 * Verifica el token del webhook enviado por Meta.
 */
export const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.metaVerifyToken) {
    console.log('✅ Webhook verificado correctamente');
    return res.status(200).send(challenge);
  } else {
    console.warn('❌ Token de verificación no coincide');
    return res.sendStatus(403);
  }
};

/**
 * Recibe y procesa los eventos entrantes de WhatsApp.
 */
export const receiveMessage = async (req, res) => {
  const requestStart = nowMs();
  try {
    const { body } = req;

    // Guard: Verificar que sea una notificación de WhatsApp Business Account
    if (body?.object !== 'whatsapp_business_account') {
      return res.status(200).send('NOT_WHATSAPP_EVENT');
    }

    const entries = body?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];

      for (const change of changes) {
        // Filtrar únicamente eventos de tipo 'messages'
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value?.messages || [];

        for (const message of messages) {
          const messageStart = nowMs();
          const from = message?.from;
          const userId = from ? `meta:${from}` : 'meta:unknown';
          const type = message?.type;
          const messageId = message?.id;
          const dedupeKey = webhookDedupe.buildProviderMessageKey('meta', messageId);
          let text = '';

          // Extraer texto según el tipo de mensaje con optional chaining
          if (type === 'text') {
            text = message.text?.body;
          } else if (type === 'button') {
            text = message.button?.text;
          } else if (type === 'interactive') {
            const interactive = message.interactive;
            if (interactive?.type === 'button_reply') {
              text = interactive.button_reply?.title;
            } else if (interactive?.type === 'list_reply') {
              text = interactive.list_reply?.title;
            }
          }

          // Si logramos obtener texto, procesamos la respuesta con el MOTOR DE FLUJOS
          if (text) {
            const perfContext = createPerfContext({
              channel: 'meta',
              flowId: 'default',
              userIdMasked: maskId(userId),
              messageIdMasked: maskId(messageId),
              inboundLength: text.length,
            });
            if (dedupeKey && (await webhookDedupe.isDuplicate(dedupeKey, perfContext))) {
              console.log(
                `[WebhookInbound] provider=meta flowId=default userId=${userId} messageId=${messageId} duplicate=true action=ignored`,
              );
              perfContext.add('duplicate', true);
              perfContext.add('totalMs', roundMs(nowMs() - messageStart));
              logPerf('meta_webhook_message', perfContext.toJSON());
              continue;
            }

            if (dedupeKey) {
              await webhookDedupe.markProcessed(dedupeKey, perfContext);
            }

            console.log(
              `[WebhookInbound] provider=meta flowId=default userId=${userId} messageId=${messageId} duplicate=false type=${type}`,
            );

            const engineStart = nowMs();
            const result = await flowEngine.resolveIncomingMessage({ userId, text, perfContext });
            perfContext.add('engineMs', roundMs(nowMs() - engineStart));

            const outboundStart = nowMs();
            await sendTextMessage({ to: from, message: result.reply });
            perfContext.add('outboundSendMs', roundMs(nowMs() - outboundStart));
            perfContext.add('replyLength', result.reply?.length || 0);
            perfContext.add('nodeId', result.currentNodeId || null);
            perfContext.add('duplicate', false);
            perfContext.add('totalMs', roundMs(nowMs() - messageStart));
            logPerf('meta_webhook_message', perfContext.toJSON());
          }
        }
      }
    }

    logPerf('meta_webhook_request', {
      totalMs: roundMs(nowMs() - requestStart),
      entryCount: entries.length,
    });
    return res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('❌ Error crítico en el controlador del webhook:', error.message);
    logPerf('meta_webhook_error', {
      totalMs: roundMs(nowMs() - requestStart),
      error: error.message,
    }, { force: true });
    return res.status(200).send('EVENT_RECEIVED');
  }
};
