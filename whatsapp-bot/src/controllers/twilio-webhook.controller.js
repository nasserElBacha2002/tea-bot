import flowEngine from '../services/flow-engine.service.js';
import webhookDedupe from '../services/webhook-dedupe.service.js';
import sessionService from '../services/session.service.js';
import { toCanonicalTwilioInboundEvent } from '../adapters/twilio/twilio-inbound.adapter.js';
import {
  buildEmptyTwimlResponse,
  buildTwimlMessage,
} from '../adapters/twilio/twilio-outbound.adapter.js';
import { createPerfContext, logPerf, maskId, nowMs, roundMs } from '../utils/perf-timer.js';

function sendTwiml(res, twiml) {
  return res.status(200).type('text/xml').send(twiml);
}

export const receiveTwilioMessage = async (req, res) => {
  const flowId = req.params.flowId;
  const requestStart = nowMs();

  try {
    const adapterStart = nowMs();
    const event = toCanonicalTwilioInboundEvent({ body: req.body, flowId });
    const perfContext = createPerfContext({
      channel: 'twilio',
      flowId: event.flowId,
      userIdMasked: maskId(event.userId),
      messageIdMasked: maskId(event.messageId),
      inboundLength: event.text?.length || 0,
    });
    perfContext.add('adapterMs', roundMs(nowMs() - adapterStart));
    const dedupeKey = webhookDedupe.buildProviderMessageKey(event.provider, event.messageId);

    if (dedupeKey && (await webhookDedupe.isDuplicate(dedupeKey, perfContext))) {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=true action=ignored`,
      );
      perfContext.add('duplicate', true);
      perfContext.add('totalMs', roundMs(nowMs() - requestStart));
      logPerf('twilio_webhook', perfContext.toJSON());
      return sendTwiml(res, buildEmptyTwimlResponse());
    }

    if (dedupeKey) {
      await webhookDedupe.markProcessed(dedupeKey, perfContext);
    }

    if (!event.text) {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false action=empty_text`,
      );
      perfContext.add('duplicate', false);
      perfContext.add('totalMs', roundMs(nowMs() - requestStart));
      logPerf('twilio_webhook', perfContext.toJSON());
      return sendTwiml(res, buildEmptyTwimlResponse());
    }

    const existingSession = sessionService.getSession(event.userId, perfContext);
    if (existingSession && existingSession.flowId !== event.flowId) {
      console.warn(
        `[TwilioWebhook] provider=${event.provider} userId=${event.userId} sessionFlow=${existingSession.flowId} requestedFlow=${event.flowId} action=reset_session`,
      );
      await sessionService.resetSession(event.userId, perfContext);
    }

    const engineStart = nowMs();
    const result = await flowEngine.resolveIncomingMessage({
      userId: event.userId,
      text: event.text,
      flowId: event.flowId,
      flowMode: 'published',
      perfContext,
    });
    perfContext.add('engineMs', roundMs(nowMs() - engineStart));

    console.log(
      `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false node=${result.currentNodeId}`,
    );

    const twimlStart = nowMs();
    const twiml = buildTwimlMessage(result.reply);
    perfContext.add('twimlBuildMs', roundMs(nowMs() - twimlStart));
    perfContext.add('replyLength', result.reply?.length || 0);
    perfContext.add('nodeId', result.currentNodeId || null);
    perfContext.add('duplicate', false);
    perfContext.add('totalMs', roundMs(nowMs() - requestStart));
    logPerf('twilio_webhook', perfContext.toJSON());
    return sendTwiml(res, twiml);
  } catch (error) {
    console.error(
      `[TwilioWebhook] provider=twilio flowId=${flowId} error=${error.message}`,
    );
    logPerf('twilio_webhook_error', {
      flowId,
      totalMs: roundMs(nowMs() - requestStart),
      error: error.message,
    }, { force: true });
    return sendTwiml(
      res,
      buildTwimlMessage(
        'No pudimos procesar tu mensaje en este momento. Intenta nuevamente en unos segundos.',
      ),
    );
  }
};
