import { normalizeTwilioWhatsappNumber } from '../../utils/twilio-phone.js';

export { normalizeTwilioWhatsappNumber };

/**
 * Contrato canónico inbound:
 * {
 *   provider: string,
 *   flowId: string,
 *   userId: string,
 *   phone: string,
 *   text: string,
 *   messageId: string,
 *   rawPayload: object
 * }
 */
export function normalizeTwilioWhatsappPhone(from) {
  const normalized = normalizeTwilioWhatsappNumber(from);
  if (normalized) return normalized;
  if (!from) return 'No informado';
  return String(from).replace(/^whatsapp:/i, '').trim() || 'No informado';
}

export function toCanonicalTwilioInboundEvent({ body, flowId }) {
  const from = typeof body?.From === 'string' ? body.From.trim() : '';
  const waId = typeof body?.WaId === 'string' ? body.WaId.trim() : '';
  const bodyText = typeof body?.Body === 'string' ? body.Body.trim() : '';
  const messageSid = typeof body?.MessageSid === 'string' ? body.MessageSid.trim() : '';
  const phone = normalizeTwilioWhatsappPhone(from);

  const userIdentity = from || (waId ? `whatsapp:${waId}` : '');
  const userId = userIdentity ? `twilio:${userIdentity}` : 'twilio:unknown';

  return {
    provider: 'twilio',
    flowId,
    userId,
    phone,
    text: bodyText,
    messageId: messageSid,
    rawPayload: body,
  };
}
