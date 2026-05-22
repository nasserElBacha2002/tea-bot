import crypto from 'crypto';

/**
 * Checksum estable del JSON de flujo (contenido de archivo o objeto normalizado).
 * @param {string | object} input
 */
export function computeFlowChecksum(input) {
  const text =
    typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
