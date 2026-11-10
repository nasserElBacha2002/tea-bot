import { config } from '../config.js';
import * as repository from './monitoring.repository.js';

const MAX_ATTEMPTS_FALLBACK = 3;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function maxAttempts() {
  const value = Number(config.webhookMaxProcessingAttempts);
  return Number.isFinite(value) && value > 0 ? value : MAX_ATTEMPTS_FALLBACK;
}

function staleBeforeDate() {
  const seconds = Number(config.webhookProcessingStaleSeconds);
  const windowSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 120;
  return new Date(Date.now() - windowSeconds * 1000);
}

/**
 * Identificador que puede ser la clave única de provider_webhook_events.
 * No se inventa uno cuando falta.
 */
export function isReliableProviderMessageId(value) {
  return typeof value === 'string' && MESSAGE_ID.test(value);
}

const OUTBOUND_SUFFIX = ':outbound';

/** Clave única del outbound automático de este MessageSid. No pisa el inbound. */
export function twilioTurnOutboundId(messageId) {
  if (!isReliableProviderMessageId(messageId)) return null;
  if (messageId.length + OUTBOUND_SUFFIX.length > 128) return null;
  return `${messageId}${OUTBOUND_SUFFIX}`;
}

function storedPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const stored = {};
  if (payload.MessageSid) stored.MessageSid = String(payload.MessageSid).slice(0, 128);
  if (payload.NumMedia != null && String(payload.NumMedia).trim() !== '') {
    stored.NumMedia = String(payload.NumMedia).slice(0, 8);
  }
  return stored;
}

export function logInbound(event, fields = {}) {
  console.log(JSON.stringify({
    event,
    provider: fields.provider || null,
    messageId: fields.messageId || null,
    flowId: fields.flowId || null,
    reason: fields.reason || null,
    attempts: fields.attempts ?? null,
    httpStatus: fields.httpStatus ?? null,
  }));
}

function gateFrom(result, event) {
  return {
    action: result.acquired ? 'process' : 'skip',
    reason: result.reason,
    tracked: true,
    id: result.row?.id || null,
    attempts: result.row?.attempts || 0,
    responseBody: result.row?.responseBody ?? null,
    provider: event?.provider || 'twilio',
    messageId: event?.messageId || null,
    flowId: event?.flowId || null,
  };
}

/**
 * Adquiere el inbound en SQL. No consulta MONITORING_ENABLED ni el archivo local.
 * Un SID ausente o inválido se rechaza sin insertar una fila.
 *
 * @param {{ event: { provider?: string, messageId?: string, flowId?: string }, payload?: object }} input
 * @param {typeof repository} [repo]
 */
export async function beginInboundEvent(input, repo = repository) {
  const event = input.event || {};
  const provider = event.provider || 'twilio';
  const providerMessageId = typeof event.messageId === 'string' ? event.messageId.trim() : '';
  const base = {
    provider,
    messageId: providerMessageId || null,
    flowId: event.flowId || null,
  };

  if (!isReliableProviderMessageId(providerMessageId)) {
    logInbound('inbound_acquire_error', { ...base, reason: 'unidentified' });
    return {
      action: 'reject',
      reason: 'unidentified',
      tracked: false,
      id: null,
      attempts: 0,
      responseBody: null,
      ...base,
    };
  }

  const payloadJson = JSON.stringify(storedPayload(input.payload));
  const result = await repo.acquireInboundProcessing({
    provider,
    eventType: 'inbound',
    providerMessageId,
    payloadJson,
    maxAttempts: maxAttempts(),
    staleBefore: staleBeforeDate(),
  });
  const gate = gateFrom(result, { ...event, provider, messageId: providerMessageId });
  if (gate.action === 'process' && gate.reason === 'reclaimed') {
    logInbound('inbound_reclaimed', gate);
  } else if (gate.action === 'process') {
    logInbound('inbound_acquired', gate);
  } else if (gate.reason === 'processed') {
    logInbound('inbound_duplicate_completed', gate);
  } else if (gate.reason === 'in_flight') {
    logInbound('inbound_already_processing', gate);
  } else {
    logInbound('inbound_failed', gate);
  }
  return gate;
}

/**
 * Cierra el lease. El tercer argumento sigue siendo el repositorio para los
 * tests existentes. responseBody es el TwiML que un retry puede reproducir.
 * El estado persistido de un turno terminado es PROCESSED, no un nombre nuevo.
 */
export async function finishInboundEvent(gate, error, repo = repository, responseBody = null) {
  if (!gate?.tracked || !gate.id) return { owned: false, replayStored: false };
  if (!error) {
    const result = await repo.markWebhookProcessed(gate.id, {
      attempts: gate.attempts,
      responseBody,
    });
    if (result?.owned !== false) {
      logInbound('inbound_completed', gate);
    } else {
      logInbound('inbound_failed', { ...gate, reason: 'lease_lost' });
    }
    return {
      owned: result?.owned !== false,
      replayStored: Boolean(result?.replayStored),
    };
  }
  const attempts = Number(gate.attempts || 1);
  const dead = attempts >= maxAttempts();
  const failed = await repo.markWebhookFailed(gate.id, {
    status: dead ? 'DEAD_LETTER' : 'FAILED',
    errorCode: error.code ? String(error.code).slice(0, 64) : null,
    errorMessage: String(error.message || error).slice(0, 400),
    attempts,
  });
  logInbound('inbound_failed', {
    ...gate,
    reason: failed?.owned === false ? 'lease_lost' : 'processing_error',
  });
  if (dead && failed?.owned !== false) {
    logInbound('inbound_dead_letter_alert', {
      ...gate,
      reason: error.code ? String(error.code).slice(0, 64) : 'processing_error',
    });
  }
  return { owned: failed?.owned !== false, replayStored: false };
}

export async function listDeadLetters(limit = 50, repo = repository) {
  return repo.listDeadLetterWebhookEvents(limit);
}

/**
 * Reintento operativo. No borra la fila ni dispara el turno por sí mismo:
 * deja FAILED con un attempt libre para que el próximo webhook lo adquiera.
 */
export async function requeueDeadLetter(id, repo = repository) {
  const result = await repo.requeueDeadLetter(id);
  if (result?.requeued) {
    logInbound('inbound_dead_letter_requeued', {
      provider: 'twilio',
      messageId: result.providerMessageId,
      attempts: result.attempts,
      reason: 'manual_requeue',
    });
  }
  return result;
}
