const EMAIL_MAX_LENGTH = 320;
const EMAIL_PATTERN =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeContactEmail(raw) {
  if (raw == null) return '';
  return String(raw).trim().toLowerCase();
}

/**
 * @param {unknown} raw
 * @returns {{ valid: true, normalized: string } | { valid: false, normalized: string, message: string }}
 */
export function validateContactEmail(raw) {
  const normalized = normalizeContactEmail(raw);
  if (!normalized) {
    return {
      valid: false,
      normalized,
      message: 'El correo no puede estar vacío.',
    };
  }
  if (normalized.length > EMAIL_MAX_LENGTH) {
    return {
      valid: false,
      normalized,
      message: `El correo no puede superar ${EMAIL_MAX_LENGTH} caracteres.`,
    };
  }
  if (/\s/.test(normalized)) {
    return {
      valid: false,
      normalized,
      message: 'El correo no puede contener espacios.',
    };
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    return {
      valid: false,
      normalized,
      message: 'El formato del correo no es válido.',
    };
  }
  return { valid: true, normalized };
}

export { EMAIL_MAX_LENGTH };
