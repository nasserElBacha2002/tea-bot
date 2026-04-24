/**
 * Contrato canónico inbound:
 * {
 *   provider: string,
 *   flowId: string,
 *   userId: string,
 *   text: string,
 *   messageId: string,
 *   rawPayload: object
 * }
 */
export function toCanonicalTwilioInboundEvent({ body, flowId }) {
  const from = typeof body?.From === 'string' ? body.From.trim() : '';
  const waId = typeof body?.WaId === 'string' ? body.WaId.trim() : '';
  const bodyText = typeof body?.Body === 'string' ? body.Body.trim() : '';
  const messageSid = typeof body?.MessageSid === 'string' ? body.MessageSid.trim() : '';

  const userIdentity = from || (waId ? `whatsapp:${waId}` : '');
  const userId = userIdentity ? `twilio:${userIdentity}` : 'twilio:unknown';

  return {
    provider: 'twilio',
    flowId,
    userId,
    text: bodyText,
    messageId: messageSid,
    rawPayload: body,
  };
}
