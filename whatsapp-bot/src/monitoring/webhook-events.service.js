import { config } from '../config.js';
import { sanitizeWebhookPayload } from './sanitize.js';
import * as repository from './monitoring.repository.js';

const MAX_ATTEMPTS_FALLBACK = 3;

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
 * DB ownership is the only process decision when monitoring persistence works.
 * The historical file dedupe is not consulted for a tracked event.
 *
 * @param {{ event: { provider?: string, messageId?: string }, payload: object }} input
 * @param {typeof repository} [repo]
 */
export async function beginInboundEvent(input, repo = repository) {
  const provider = input.event?.provider || 'twilio';
  const providerMessageId = input.event?.messageId || null;
  const payloadJson = JSON.stringify(sanitizeWebhookPayload(input.payload));

  if (!providerMessageId) {
    const inserted = await repo.insertWebhookEvent({
      provider,
      eventType: 'inbound',
      providerMessageId: null,
      status: 'PROCESSING',
      attempts: 1,
      payloadJson,
    });
    return {
      action: 'process',
      reason: 'acquired',
      tracked: Boolean(inserted.row?.id),
      id: inserted.row?.id || null,
      attempts: inserted.row?.attempts || 1,
    };
  }

  const result = await repo.acquireInboundProcessing({
    provider,
    eventType: 'inbound',
    providerMessageId,
    payloadJson,
    maxAttempts: maxAttempts(),
    staleBefore: staleBeforeDate(),
  });
  return {
    action: result.acquired ? 'process' : 'skip',
    reason: result.reason,
    tracked: true,
    id: result.row?.id || null,
    attempts: result.row?.attempts || 0,
  };
}

export async function finishInboundEvent(gate, error, repo = repository) {
  if (!gate?.tracked || !gate.id) return;
  if (!error) {
    await repo.markWebhookProcessed(gate.id);
    return;
  }
  const attempts = Number(gate.attempts || 1);
  await repo.markWebhookFailed(gate.id, {
    status: attempts >= maxAttempts() ? 'DEAD_LETTER' : 'FAILED',
    errorCode: error.code ? String(error.code).slice(0, 64) : null,
    errorMessage: String(error.message || error).slice(0, 400),
  });
}
