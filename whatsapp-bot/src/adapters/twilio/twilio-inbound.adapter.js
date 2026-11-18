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
 *   media: Array<{ index: number, url: string, contentType: string, fileName: string | null }>,
 *   rawPayload: object
 * }
 */
export function parseTwilioInboundMedia(body) {
  const count = Number.parseInt(String(body?.NumMedia ?? '0'), 10);
  if (!Number.isFinite(count) || count <= 0) return [];
  const capped = Math.min(count, 10);
  const items = [];
  for (let index = 0; index < capped; index += 1) {
    const url = typeof body?.[`MediaUrl${index}`] === 'string' ? body[`MediaUrl${index}`].trim() : '';
    if (!url) continue;
    const contentType = typeof body?.[`MediaContentType${index}`] === 'string'
      ? body[`MediaContentType${index}`].trim()
      : '';
    const fileName = typeof body?.[`MediaFilename${index}`] === 'string'
      ? body[`MediaFilename${index}`].trim()
      : typeof body?.[`MediaFileName${index}`] === 'string'
        ? body[`MediaFileName${index}`].trim()
        : null;
    items.push({ index, url, contentType, fileName: fileName || null });
  }
  return items;
}

export function hasInboundMedia(event) {
  return Array.isArray(event?.media) && event.media.length > 0;
}

export function inboundEventHasProcessableContent(event) {
  return Boolean(String(event?.text ?? '').trim()) || hasInboundMedia(event);
}
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
    media: parseTwilioInboundMedia(body),
    rawPayload: body,
  };
}
