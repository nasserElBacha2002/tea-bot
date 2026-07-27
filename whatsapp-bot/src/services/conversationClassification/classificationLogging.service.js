import { config } from '../../config.js';

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
}

class ClassificationLoggingService {
  logClassificationEvent(payload) {
    if (!config.conversationClassificationLoggingEnabled) return;

    const event = {
      event: 'conversation_primary_query_classified',
      conversationId: payload.conversationId || null,
      flowId: payload.classification?.flowId || null,
      flowVersion: payload.classification?.flowVersion || null,
      classifierVersion: payload.classification?.classifierVersion || null,
      source: payload.classification?.source || 'fallback',
      matchedNode: payload.classification?.matchedNode || null,
      matchedRule: payload.classification?.matchedRule || null,
      result: payload.classification?.primaryQuery || null,
      confidence: payload.classification?.confidence ?? 0,
      fallback: payload.classification?.source === 'fallback',
      reason: payload.classification?.source === 'fallback' ? 'no_evidence' : null,
      legacyResult: payload.legacyClassification?.primaryQuery || null,
      shadowDiff: Boolean(payload.shadowDiff),
      sheetOperation: payload.sheetOperation || null,
      phoneMasked: payload.phoneMasked ? maskPhone(payload.phoneMasked) : undefined,
    };

    console.log(JSON.stringify(event));
  }

  logSheetOperation(payload) {
    if (!config.conversationClassificationLoggingEnabled) return;
    console.log(JSON.stringify({
      event: 'conversation_sheet_sync',
      conversationId: payload.conversationId || null,
      sheetOperation: payload.sheetOperation,
      sheetRow: payload.sheetRow || null,
      duplicatePrevented: Boolean(payload.duplicatePrevented),
      success: Boolean(payload.success),
      reason: payload.reason || null,
    }));
  }
}

const classificationLoggingService = new ClassificationLoggingService();
export default classificationLoggingService;
