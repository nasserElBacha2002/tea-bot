/** Estados explícitos de exportación / sync con Google Sheets. */
export const SHEET_EXPORT_OUTCOMES = {
  CONFIRMED: 'confirmed',
  ESCALATION_CONFIRMED: 'escalation_confirmed',
  INTENTIONALLY_DISABLED: 'intentionally_disabled',
  ALREADY_EXPORTED_VERIFIED: 'already_exported_verified',
  DUPLICATE_PREVENTED: 'duplicate_prevented',
  RECOVERABLE_ERROR: 'recoverable_error',
  AMBIGUOUS_WRITE: 'ambiguous_write',
  IDENTITY_CONFLICT: 'identity_conflict',
  IDENTITY_NOT_FOUND: 'identity_not_found',
  MISSING_CONVERSATION_ID_COLUMN: 'missing_conversation_id_column',
  DEFINITIVE_ERROR: 'definitive_error',
};

export function shouldPersistPrimaryExportedAt(outcome) {
  return outcome === SHEET_EXPORT_OUTCOMES.CONFIRMED;
}

export function shouldPersistEscalationExportedAt(outcome) {
  return outcome === SHEET_EXPORT_OUTCOMES.ESCALATION_CONFIRMED;
}

const RECOVERABLE_REASONS = new Set([
  'missing_config',
  'timeout',
  'network',
  'rate_limited',
  'append_response_lost',
  'export_in_progress',
]);

export function isRecoverableExportOutcome(outcome, reason = null) {
  if (outcome === SHEET_EXPORT_OUTCOMES.DEFINITIVE_ERROR) return false;
  if (RECOVERABLE_REASONS.has(String(reason || ''))) return true;
  return outcome === SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR
    || outcome === SHEET_EXPORT_OUTCOMES.AMBIGUOUS_WRITE
    || outcome === SHEET_EXPORT_OUTCOMES.IDENTITY_NOT_FOUND
    || outcome === SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED;
}

export function isRecoverableExportException(error) {
  const code = String(error?.code || '');
  if (['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('timeout')
    || message.includes('network')
    || message.includes('rate')
    || message.includes('temporar');
}

export function classifySheetSyncResult(res, { sheetsEnabled = true, escalation = false } = {}) {
  if (!sheetsEnabled) {
    return { outcome: SHEET_EXPORT_OUTCOMES.INTENTIONALLY_DISABLED, exported: false, skipped: true };
  }
  if (!res) {
    return { outcome: SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR, exported: false, skipped: true };
  }
  if (res.outcome) {
    return {
      outcome: res.outcome,
      exported: Boolean(res.exported),
      skipped: Boolean(res.skipped),
      reason: res.reason || null,
    };
  }
  if (res.skipped) {
    if (res.reason === 'already_exported_pending_row' || res.duplicatePrevented) {
      return {
        outcome: SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED,
        exported: false,
        skipped: true,
        reason: res.reason,
      };
    }
    if (res.reason === 'disabled') {
      return {
        outcome: SHEET_EXPORT_OUTCOMES.INTENTIONALLY_DISABLED,
        exported: false,
        skipped: true,
        reason: res.reason,
      };
    }
    if (res.reason === 'missing_config') {
      return {
        outcome: SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR,
        exported: false,
        skipped: true,
        reason: res.reason,
      };
    }
    return {
      outcome: SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR,
      exported: false,
      skipped: true,
      reason: res.reason,
    };
  }
  if (escalation && res.operation === 'update') {
    return {
      outcome: SHEET_EXPORT_OUTCOMES.ESCALATION_CONFIRMED,
      exported: true,
      skipped: false,
      reason: res.reason || null,
    };
  }
  return {
    outcome: SHEET_EXPORT_OUTCOMES.CONFIRMED,
    exported: true,
    skipped: false,
    reason: res.reason || null,
  };
}