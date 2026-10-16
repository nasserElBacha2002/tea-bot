import { config } from '../config.js';
import webhookDedupe from '../services/webhook-dedupe.service.js';
import { processCanonicalTwilioInbound } from '../services/twilio-inbound-pipeline.js';
import { toCanonicalTwilioInboundEvent } from '../adapters/twilio/twilio-inbound.adapter.js';
import {
  buildEmptyTwimlResponse,
  buildTwimlMessage,
} from '../adapters/twilio/twilio-outbound.adapter.js';
import { createPerfContext, logPerf, maskId, nowMs, roundMs } from '../utils/perf-timer.js';
import { noteActivity } from '../monitoring/activity-store.js';
import { beginInboundEvent, finishInboundEvent } from '../monitoring/webhook-events.service.js';

function sendTwiml(res, twiml) {
  return res.status(200).type('text/xml').send(twiml);
}

async function openMonitoringGate(event, body) {
  if (!config.monitoringEnabled) return { action: 'process', tracked: false };
  try {
    return await beginInboundEvent({ event, payload: body });
  } catch (error) {
    console.error(`[Monitoring] webhook persist failed: ${error.message}`);
    return { action: 'process', tracked: false };
  }
}

async function closeMonitoringGate(gate, error) {
  if (!gate?.tracked) return;
  try {
    await finishInboundEvent(gate, error || null);
  } catch (err) {
    console.error(`[Monitoring] webhook status update failed: ${err.message}`);
  }
}

export const receiveTwilioMessage = async (req, res) => {
  const flowId = req.params.flowId;
  const requestStart = nowMs();
  let gate = { action: 'process', tracked: false };

  try {
    const adapterStart = nowMs();
    const event = toCanonicalTwilioInboundEvent({ body: req.body, flowId });
    noteActivity('lastInboundAt');
    console.log('Twilio From:', req.body?.From);
    console.log('Normalized phone:', event.phone);
    const perfContext = createPerfContext({
      channel: 'twilio',
      flowId: event.flowId,
      userIdMasked: maskId(event.userId),
      messageIdMasked: maskId(event.messageId),
      inboundLength: event.text?.length || 0,
    });
    perfContext.add('adapterMs', roundMs(nowMs() - adapterStart));
    const dedupeKey = webhookDedupe.buildProviderMessageKey(event.provider, event.messageId);
    gate = await openMonitoringGate(event, req.body);

    if (gate.action === 'skip') {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=true action=ignored`,
      );
      perfContext.add('duplicate', true);
      perfContext.add('totalMs', roundMs(nowMs() - requestStart));
      logPerf('twilio_webhook', perfContext.toJSON());
      return sendTwiml(res, buildEmptyTwimlResponse());
    }

    if (!gate.tracked) {
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
    }

    const markHandled = async ({ flow = false } = {}) => {
      noteActivity('lastProcessedAt');
      if (flow) noteActivity('lastSuccessfulFlowAt');
      if (gate.tracked && dedupeKey) {
        try {
          await webhookDedupe.markProcessed(dedupeKey, perfContext);
        } catch (error) {
          console.error(`[Monitoring] dedupe mark failed: ${error.message}`);
        }
      }
      await closeMonitoringGate(gate, null);
    };

    if (!event.text) {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false action=empty_text`,
      );
      perfContext.add('duplicate', false);
      perfContext.add('totalMs', roundMs(nowMs() - requestStart));
      logPerf('twilio_webhook', perfContext.toJSON());
      await markHandled();
      return sendTwiml(res, buildEmptyTwimlResponse());
    }

    const processed = await processCanonicalTwilioInbound(event, { perfContext });

    if (processed.kind === 'human_mode_skip') {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false action=human_mode_skip_engine status=${processed.conversation?.status}`,
      );
      perfContext.add('humanModeSkip', true);
      perfContext.add('conversationStatus', processed.conversation?.status || null);
      perfContext.add('totalMs', roundMs(nowMs() - requestStart));
      logPerf('twilio_webhook', perfContext.toJSON());
      await markHandled();
      return sendTwiml(res, buildEmptyTwimlResponse());
    }

    if (processed.kind === 'human_handoff') {
      console.log(
        `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false action=human_handoff node=${processed.result?.currentNodeId}`,
      );
      perfContext.add('humanHandoff', true);
      perfContext.add('nodeId', processed.result?.currentNodeId || null);
      perfContext.add('totalMs', roundMs(nowMs() - requestStart));
      logPerf('twilio_webhook', perfContext.toJSON());
      await markHandled({ flow: true });
      if (processed.shouldSendTwiml === false) {
        return sendTwiml(res, buildEmptyTwimlResponse());
      }
      return sendTwiml(res, buildTwimlMessage(processed.reply));
    }

    console.log(
      `[WebhookInbound] provider=${event.provider} flowId=${event.flowId} userId=${event.userId} messageId=${event.messageId} duplicate=false node=${processed.result?.currentNodeId}`,
    );

    const twimlStart = nowMs();
    const twiml = buildTwimlMessage(processed.reply);
    perfContext.add('twimlBuildMs', roundMs(nowMs() - twimlStart));
    perfContext.add('replyLength', processed.reply?.length || 0);
    perfContext.add('nodeId', processed.result?.currentNodeId || null);
    perfContext.add('duplicate', false);
    perfContext.add('totalMs', roundMs(nowMs() - requestStart));
    logPerf('twilio_webhook', perfContext.toJSON());
    await markHandled({ flow: true });
    return sendTwiml(res, twiml);
  } catch (error) {
    noteActivity('lastErrorAt', error.message);
    await closeMonitoringGate(gate, error);
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
