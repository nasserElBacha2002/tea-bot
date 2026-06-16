const MAX_CONTACT_NAME_LENGTH = 150;
const CONTACT_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u;

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeContactName(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function validateContactName(raw) {
  const normalized = normalizeContactName(raw);
  if (!normalized) {
    const err = new Error('El nombre no puede estar vacío');
    err.code = 'INVALID_CONTACT_NAME';
    err.httpStatus = 400;
    err.apiError = 'INVALID_CONTACT_NAME';
    err.apiMessage = err.message;
    throw err;
  }
  if (normalized.length > MAX_CONTACT_NAME_LENGTH) {
    const err = new Error(`El nombre no puede superar ${MAX_CONTACT_NAME_LENGTH} caracteres`);
    err.code = 'CONTACT_NAME_TOO_LONG';
    err.httpStatus = 400;
    err.apiError = 'CONTACT_NAME_TOO_LONG';
    err.apiMessage = err.message;
    throw err;
  }
  if (!CONTACT_NAME_PATTERN.test(normalized)) {
    const err = new Error(
      'El nombre solo puede contener letras, espacios, acentos, apóstrofes y guiones',
    );
    err.code = 'INVALID_CONTACT_NAME';
    err.httpStatus = 400;
    err.apiError = 'INVALID_CONTACT_NAME';
    err.apiMessage = err.message;
    throw err;
  }
  return normalized;
}

export { MAX_CONTACT_NAME_LENGTH };
