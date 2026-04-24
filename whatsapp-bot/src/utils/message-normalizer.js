/**
 * Normaliza el texto entrante para facilitar la comparación.
 * @param {string} text - El texto original.
 * @returns {string} - El texto en minúsculas y sin espacios adicionales.
 */
export const normalizeMessage = (text = '') => {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().trim();
};
