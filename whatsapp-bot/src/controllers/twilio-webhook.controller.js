import flowEngine from '../services/flow-engine.service.js';
import webhookDedupe from '../services/webhook-dedupe.service.js';
import sessionService from '../services/session.service.js';
import { toCanonicalTwilioInboundEvent } from '../adapters/twilio/twilio-inbound.adapter.js';
import {
  buildEmptyTwimlResponse,
  buildTwimlMessage,
} from '../adapters/twilio/twilio-outbound.adapter.js';

function sendTwiml(res, twiml) {
  return res.status(200).type('text/xml').send(twiml);
}

export const receiveTwilioMessage = async (req, res) => {
  const flowId = req.params.flowId;

  try {
    const event = toCanonicalTwilioInboundEvent({ body: req.body, flowId });
    const dedupeKey = webhookDedupe.buildProviderMessageKey(event.provider, event.messageId);

    if (dedupeKey && (await webhookDedupe.isDuplicate(dedupeKey))) {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=true action=ignored`,
      );
      return sendTwiml(res, buildEmptyTwimlResponse());
    }

    if (dedupeKey) {
      await webhookDedupe.markProcessed(dedupeKey);
    }

    if (!event.text) {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false action=empty_text`,
      );
      return sendTwiml(res, buildEmptyTwimlResponse());
    }

    const existingSession = sessionService.getSession(event.userId);
    if (existingSession && existingSession.flowId !== event.flowId) {
      console.warn(
        `[TwilioWebhook] provider=${event.provider} userId=${event.userId} sessionFlow=${existingSession.flowId} requestedFlow=${event.flowId} action=reset_session`,
      );
      await sessionService.resetSession(event.userId);
    }

    const result = await flowEngine.resolveIncomingMessage({
      userId: event.userId,
      text: event.text,
      flowId: event.flowId,
      flowMode: 'published',
    });

    console.log(
      `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false node=${result.currentNodeId}`,
    );

    return sendTwiml(res, buildTwimlMessage(result.reply));
  } catch (error) {
    console.error(
      `[TwilioWebhook] provider=twilio flowId=${flowId} error=${error.message}`,
    );
    return sendTwiml(
      res,
      buildTwimlMessage(
        'No pudimos procesar tu mensaje en este momento. Intenta nuevamente en unos segundos.',
      ),
    );
  }
};
