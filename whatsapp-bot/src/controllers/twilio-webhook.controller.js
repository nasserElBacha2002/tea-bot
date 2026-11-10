import { processCanonicalTwilioInbound } from '../services/twilio-inbound-pipeline.js';
import { toCanonicalTwilioInboundEvent } from '../adapters/twilio/twilio-inbound.adapter.js';
import {
  buildEmptyTwimlResponse,
  buildTwimlMessage,
} from '../adapters/twilio/twilio-outbound.adapter.js';
import { createPerfContext, logPerf, maskId, nowMs, roundMs } from '../utils/perf-timer.js';
import { noteActivity } from '../monitoring/activity-store.js';
import {
  beginInboundEvent,
  finishInboundEvent,
  logInbound,
} from '../monitoring/webhook-events.service.js';

/**
 * Idempotencia del inbound Twilio. SQL es la autoridad, con o sin monitoreo.
 * PROCESSED significa que los efectos internos de ese intento quedaron
 * comprometidos y que el TwiML guardado puede repetirse. No significa que
 * Twilio haya aceptado el HTTP ni que WhatsApp haya entregado el mensaje.
 *
 * Un PROCESSING vigente responde 503 para que Twilio reintente. Un 200 en
 * ese caso cerraría el único reintento mientras el dueño todavía puede fallar.
 * Un fallo de adquisición no cae al archivo local ni ejecuta el turno.
 */

function twimlForTurn(processed) {
  if (!processed) return buildEmptyTwimlResponse();
  if (processed.kind === 'reply_indeterminate' || processed.kind === 'human_mode_skip') {
    return buildEmptyTwimlResponse();
  }
  if (processed.replyAuthorized === false) return buildEmptyTwimlResponse();
  if (processed.kind === 'human_handoff' && processed.shouldSendTwiml === false) {
    return buildEmptyTwimlResponse();
  }
  if (processed.reply == null || processed.reply === '') return buildEmptyTwimlResponse();
  return buildTwimlMessage(processed.reply);
}

function skippedResponse(gate) {
  if (gate.reason === 'in_flight') {
    return { httpStatus: 503, twiml: buildEmptyTwimlResponse() };
  }
  if (gate.reason === 'processed') {
    return {
      httpStatus: 200,
      twiml: gate.responseBody || buildEmptyTwimlResponse(),
    };
  }
  return { httpStatus: 200, twiml: buildEmptyTwimlResponse() };
}

export async function settleTwilioInbound({
  flowId,
  body,
  processInbound = processCanonicalTwilioInbound,
  begin = beginInboundEvent,
  finish = (gate, error, responseBody) => finishInboundEvent(gate, error, undefined, responseBody),
} = {}) {
  const requestStart = nowMs();
  const event = toCanonicalTwilioInboundEvent({ body, flowId });
  noteActivity('lastInboundAt');
  const perfContext = createPerfContext({
    channel: 'twilio',
    flowId: event.flowId,
    userIdMasked: maskId(event.userId),
    messageIdMasked: maskId(event.messageId),
    inboundLength: event.text?.length || 0,
  });

  let gate;
  try {
    gate = await begin({ event, payload: body });
  } catch (error) {
    noteActivity('lastErrorAt', error.message);
    logInbound('inbound_acquire_error', {
      provider: event.provider,
      messageId: event.messageId || null,
      flowId: event.flowId,
      reason: 'sql_error',
      httpStatus: 503,
    });
    logPerf('twilio_webhook_error', {
      flowId,
      totalMs: roundMs(nowMs() - requestStart),
      error: error.message,
    }, { force: true });
    return { httpStatus: 503, twiml: buildEmptyTwimlResponse(), gate: null };
  }

  if (gate.action === 'reject') {
    return { httpStatus: 400, twiml: buildEmptyTwimlResponse(), gate };
  }
  if (gate.action !== 'process') {
    perfContext.add('duplicate', true);
    perfContext.add('totalMs', roundMs(nowMs() - requestStart));
    logPerf('twilio_webhook', perfContext.toJSON());
    return { ...skippedResponse(gate), gate };
  }

  try {
    let processed = null;
    if (event.text) {
      processed = await processInbound(event, {
        perfContext,
        lease: gate?.id ? { id: gate.id, attempts: gate.attempts } : null,
      });
    }
    if (processed?.kind === 'reply_indeterminate') {
      const indeterminate = new Error(processed.reason || 'reply_indeterminate');
      indeterminate.code = processed.reason || 'REPLY_INDETERMINATE';
      throw indeterminate;
    }
    const twiml = event.text ? twimlForTurn(processed) : buildEmptyTwimlResponse();
    const finished = await finish(gate, null, twiml);
    if (finished?.owned === false) {
      return { httpStatus: 503, twiml: buildEmptyTwimlResponse(), gate };
    }
    noteActivity('lastProcessedAt');
    if (processed && processed.kind !== 'human_mode_skip' && processed.replyAuthorized !== false) {
      noteActivity('lastSuccessfulFlowAt');
    }
    perfContext.add('duplicate', false);
    perfContext.add('totalMs', roundMs(nowMs() - requestStart));
    logPerf('twilio_webhook', perfContext.toJSON());
    return { httpStatus: 200, twiml, gate };
  } catch (error) {
    noteActivity('lastErrorAt', error.message);
    logPerf('twilio_webhook_error', {
      flowId,
      totalMs: roundMs(nowMs() - requestStart),
      error: error.message,
    }, { force: true });
    try {
      await finish(gate, error, null);
    } catch (finishError) {
      logInbound('inbound_acquire_error', {
        provider: event.provider,
        messageId: event.messageId || null,
        flowId: event.flowId,
        reason: 'fail_record_failed',
        httpStatus: 503,
      });
    }
    return { httpStatus: 503, twiml: buildEmptyTwimlResponse(), gate };
  }
}

export const receiveTwilioMessage = async (req, res) => {
  const result = await settleTwilioInbound({
    flowId: req.params.flowId,
    body: req.body,
  });
  return res.status(result.httpStatus).type('text/xml').send(result.twiml);
};
