/**
 * Resuelve instante de captura sin usar hora de procesamiento salvo opt-in explícito.
 * Twilio: received_at refleja orden de recepción en el webhook, no necesariamente envío del usuario.
 */
export function resolveContactEmailSourceEvent(options = {}) {
  const explicit = options.sourceEventAt || options.messageCreatedAt || options.inboundEventAt;
  if (explicit) {
    const eventAt = new Date(explicit);
    if (!Number.isNaN(eventAt.getTime())) {
      return { eventAt, provenance: 'provider_or_explicit', allowSqlWrite: true };
    }
  }
  if (options.allowProcessingFallback === true) {
    return { eventAt: new Date(), provenance: 'processing_fallback', allowSqlWrite: true };
  }
  return { eventAt: null, provenance: 'missing', allowSqlWrite: false };
}