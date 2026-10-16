import { config } from '../config.js';
import { sanitizeWebhookPayload } from './sanitize.js';
import * as repository from './monitoring.repository.js';

const MAX_ATTEMPTS_FALLBACK = 3;

function maxAttempts() {
  const value = Number(config.webhookMaxProcessingAttempts);
  return Number.isFinite(value) && value > 0 ? value : MAX_ATTEMPTS_FALLBACK;
}

/**
 * @param {{ event: { provider?: string, messageId?: string }, payload: object }} input
 * @param {typeof repository} [repo]
 */
export async function beginInboundEvent(input, repo = repository) {
  const provider = input.event?.provider || 'twilio';
  const providerMessageId = input.event?.messageId || null;
  const payloadJson = JSON.stringify(sanitizeWebhookPayload(input.payload));
  if (providerMessageId) {
    const existing = await repo.findWebhookEvent(provider, 'inbound', providerMessageId);
    if (existing?.status === 'PROCESSED' || existing?.status === 'DEAD_LETTER') {
      return { action: 'skip', tracked: true, id: existing.id, attempts: existing.attempts };
    }
    if (existing && existing.attempts >= maxAttempts() && existing.status !== 'PROCESSED') {
      await repo.markWebhookFailed(existing.id, {
        status: 'DEAD_LETTER',
        errorCode: existing.errorCode,
        errorMessage: existing.errorMessage || 'max_attempts',
      });
      return { action: 'skip', tracked: true, id: existing.id, attempts: existing.attempts };
    }
    if (existing && (existing.status === 'FAILED' || existing.status === 'RECEIVED' || existing.status === 'PROCESSING')) {
      const attempts = existing.attempts + (existing.status === 'FAILED' ? 1 : 0);
      if (attempts > maxAttempts()) {
        await repo.markWebhookFailed(existing.id, {
          status: 'DEAD_LETTER',
          errorCode: existing.errorCode,
          errorMessage: existing.errorMessage || 'max_attempts',
        });
        return { action: 'skip', tracked: true, id: existing.id, attempts: existing.attempts };
      }
      await repo.markWebhookProcessing(existing.id, attempts);
      return { action: 'process', tracked: true, id: existing.id, attempts };
    }
  }

  const inserted = await repo.insertWebhookEvent({
    provider,
    eventType: 'inbound',
    providerMessageId,
    status: 'PROCESSING',
    attempts: 1,
    payloadJson,
  });
  if (!inserted.inserted && inserted.row?.status === 'PROCESSED') {
    return { action: 'skip', tracked: true, id: inserted.row.id, attempts: inserted.row.attempts };
  }
  return {
    action: 'process',
    tracked: true,
    id: inserted.row?.id || null,
    attempts: inserted.row?.attempts || 1,
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
