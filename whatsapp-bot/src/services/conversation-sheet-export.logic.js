import { SHEET_EXPORT_OUTCOMES } from './sheet-export-outcome.js';

export function findDuplicateHeaders(headers = []) {
  const seen = new Set();
  const duplicates = [];
  for (const header of headers) {
    const key = String(header);
    if (seen.has(key)) duplicates.push(key);
    else seen.add(key);
  }
  return duplicates;
}

/**
 * Alinea valores al orden real de encabezados de la planilla.
 */
export function mapRowValuesToSheetHeaders(sheetHeaders, sourceHeaders, sourceRow) {
  if (!Array.isArray(sheetHeaders) || sheetHeaders.length === 0) return sourceRow;
  return sheetHeaders.map((header) => {
    const idx = sourceHeaders.indexOf(header);
    if (idx < 0 || idx >= sourceRow.length) return '';
    return sourceRow[idx];
  });
}

/**
 * @param {{
 *   resolved: { status: string, sheetRow?: number, reason?: string },
 *   existingLedger: object | null,
 *   escalation: boolean,
 *   updateEnabled: boolean,
 *   storedRowValid?: boolean,
 *   storedRowNumber?: number | null,
 * }} input
 */
export function decideSheetExportAction(input) {
  const {
    resolved,
    existingLedger,
    escalation,
    updateEnabled,
    storedRowValid = false,
    storedRowNumber = null,
  } = input;

  if (resolved.status === 'duplicate') {
    return { action: 'abort', outcome: SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT, reason: resolved.reason };
  }
  if (resolved.status === 'missing_column') {
    return { action: 'abort', outcome: SHEET_EXPORT_OUTCOMES.MISSING_CONVERSATION_ID_COLUMN, reason: resolved.reason };
  }
  if (resolved.status === 'missing_conversation_id') {
    return { action: 'abort', outcome: SHEET_EXPORT_OUTCOMES.IDENTITY_NOT_FOUND, reason: resolved.reason };
  }

  const uniqueRow = resolved.status === 'unique' ? resolved.sheetRow : null;
  const targetRow = uniqueRow || (storedRowValid ? storedRowNumber : null);

  if (targetRow && updateEnabled) {
    return { action: 'update', sheetRow: targetRow, outcome: null };
  }

  if (uniqueRow && !updateEnabled) {
    return {
      action: 'abort',
      outcome: SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT,
      reason: 'sheet_row_exists_update_disabled',
    };
  }

  const ledgerHasPhysicalRow = Boolean(targetRow || existingLedger?.sheetRowNumber);
  const coordinating = ['coordinating', 'acquired', 'in_progress', 'failed', 'ambiguous'].includes(
    existingLedger?.exportStatus,
  ) || ['acquired', 'in_progress', 'ambiguous'].includes(existingLedger?.coordinatorState);
  if (existingLedger && !escalation && ledgerHasPhysicalRow && !coordinating) {
    return {
      action: 'skip',
      outcome: SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED,
      reason: 'already_exported_pending_row',
    };
  }

  if (existingLedger && !targetRow && resolved.status === 'not_found' && !coordinating) {
    return {
      action: 'abort',
      outcome: SHEET_EXPORT_OUTCOMES.AMBIGUOUS_WRITE,
      reason: 'ledger_without_physical_row',
    };
  }

  if (resolved.status === 'not_found') {
    return { action: 'append', outcome: null };
  }

  return { action: 'abort', outcome: SHEET_EXPORT_OUTCOMES.IDENTITY_NOT_FOUND, reason: 'row_unresolved' };
}