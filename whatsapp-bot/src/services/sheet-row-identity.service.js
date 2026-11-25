import { CONVERSATION_ID_COLUMN_HEADER } from './conversationSheetFormatter.service.js';

/**
 * Resuelve fila por Conversation ID sin heurísticas de teléfono/fecha.
 * @returns {{ status: string, sheetRow?: number, sheetRows?: number[], reason?: string }}
 */
export function resolveSheetRowByConversationId(headers, dataRows, conversationId) {
  if (!conversationId) {
    return { status: 'missing_conversation_id', reason: 'missing_conversation_id' };
  }

  const idx = headers.indexOf(CONVERSATION_ID_COLUMN_HEADER);
  if (idx < 0) {
    return { status: 'missing_column', reason: 'conversation_id_column_missing' };
  }

  const target = String(conversationId).trim().toLowerCase();
  const matches = [];

  for (let i = 0; i < dataRows.length; i += 1) {
    const value = String(dataRows[i]?.[idx] || '').trim().toLowerCase();
    if (value && value === target) {
      matches.push(i + 2);
    }
  }

  if (matches.length === 0) {
    return { status: 'not_found', reason: 'row_not_found' };
  }
  if (matches.length === 1) {
    return { status: 'unique', sheetRow: matches[0], reason: null };
  }

  return {
    status: 'duplicate',
    sheetRows: matches,
    reason: 'duplicate_conversation_id_rows',
  };
}

/**
 * Verifica que la fila almacenada sigue perteneciendo al Conversation ID esperado.
 */
export function validateStoredSheetRow(headers, dataRows, sheetRowNumber, conversationId) {
  if (!sheetRowNumber || !conversationId) {
    return { valid: false, status: 'missing_reference', reason: 'missing_row_or_conversation_id' };
  }
  const idx = headers.indexOf(CONVERSATION_ID_COLUMN_HEADER);
  if (idx < 0) {
    return { valid: false, status: 'missing_column', reason: 'conversation_id_column_missing' };
  }
  const dataIndex = sheetRowNumber - 2;
  if (dataIndex < 0 || dataIndex >= dataRows.length) {
    return { valid: false, status: 'row_missing', reason: 'stored_row_out_of_range' };
  }
  const cell = String(dataRows[dataIndex]?.[idx] || '').trim().toLowerCase();
  const target = String(conversationId).trim().toLowerCase();
  if (!cell || cell !== target) {
    return { valid: false, status: 'mismatch', reason: 'stored_row_conversation_mismatch' };
  }
  return { valid: true, status: 'valid', reason: null };
}