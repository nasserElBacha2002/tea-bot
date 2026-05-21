/**
 * Normaliza el identificador WhatsApp de Twilio a E.164 sin prefijo `whatsapp:`.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeTwilioWhatsappNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const withoutPrefix = raw.replace(/^whatsapp:/i, '').trim();
  if (!withoutPrefix) return null;

  if (/^\+[1-9]\d{6,14}$/.test(withoutPrefix)) {
    return withoutPrefix;
  }

  const digitsOnly = withoutPrefix.replace(/\D/g, '');
  if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }

  return null;
}
