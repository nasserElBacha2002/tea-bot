/**
 * Google Sheets con valueInputOption RAW conserva el literal del texto.
 * Solo neutralizamos prefijos que Sheets podría tratar como fórmula al importar CSV.
 */
export function sanitizeSheetCellValue(value, options = {}) {
  if (value == null) return '';
  const text = String(value);
  if (!text) return text;
  if (options.rawLiteral !== false) {
    return text;
  }
  const trimmed = text.trimStart();
  if (/^=/.test(trimmed)) {
    return `'${text}`;
  }
  return text;
}

export function sanitizeSheetRow(rowValues) {
  if (!Array.isArray(rowValues)) return [];
  return rowValues.map(sanitizeSheetCellValue);
}