import { config } from '../config.js';
import googleSheetsService, { columnToLetter } from './googleSheets.service.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import classificationLoggingService from './conversationClassification/classificationLogging.service.js';
import classificationMetricsService from './conversationClassification/classificationMetrics.service.js';
import {
  CONVERSATION_ID_COLUMN_HEADER,
  findSheetRowByConversationId,
} from './conversationSheetFormatter.service.js';

function parseRowNumberFromUpdatedRange(updatedRange) {
  const match = String(updatedRange || '').match(/![A-Z]+(\d+)(?::|$)/i);
  return match ? Number(match[1]) : null;
}

function buildIdempotencyKey(conversationId, finalStatus, escalation = false) {
  if (!conversationId) return `session:${finalStatus}:${Date.now()}`;
  if (escalation) return `conversation:${conversationId}:escalation:${finalStatus}`;
  return `conversation:${conversationId}:primary`;
}

class ConversationSheetExportService {
  async findExistingExport(conversationId, tabName) {
    if (!conversationSheetExportRepository.isEnabled() || !conversationId) return null;
    return conversationSheetExportRepository.findLatestByConversationAndTab(conversationId, tabName);
  }

  async resolveSheetRowNumber(conversationId, headers, existing) {
    if (existing?.sheetRowNumber) return existing.sheetRowNumber;
    if (!conversationId || !config.conversationClassificationSheetUpdateEnabled) return null;

    const tabName = config.googleSheetsTabName;
    const values = await googleSheetsService.readTabValues(tabName);
    const sheetHeaders = values[0]?.length ? values[0] : headers;
    const dataRows = values.slice(1);
    const rowNumber = findSheetRowByConversationId(sheetHeaders, dataRows, conversationId);
    if (rowNumber && existing?.id) {
      await conversationSheetExportRepository.updateExport(existing.id, { sheetRowNumber: rowNumber });
    }
    return rowNumber;
  }

  async syncFormattedRow({
    conversationId,
    finalStatus,
    headers,
    row,
    escalation = false,
  }) {
    const tabName = config.googleSheetsTabName;
    const idempotencyKey = buildIdempotencyKey(conversationId, finalStatus, escalation);
    const existing = conversationId
      ? await this.findExistingExport(conversationId, tabName)
      : null;

    const sheetRowNumber = await this.resolveSheetRowNumber(conversationId, headers, existing);
    const canUpdate =
      config.conversationClassificationSheetUpdateEnabled
      && Boolean(sheetRowNumber);

    if (canUpdate) {
      const endCol = columnToLetter(headers.length - 1);
      const range = `A${sheetRowNumber}:${endCol}${sheetRowNumber}`;
      const res = await googleSheetsService.updateRowRange(tabName, range, row);
      if (conversationSheetExportRepository.isEnabled() && conversationId) {
        if (existing) {
          await conversationSheetExportRepository.updateExport(existing.id, {
            sheetRowNumber,
            lastSyncAt: new Date(),
            exportStatus: 'updated',
            finalStatus,
          });
        } else {
          await conversationSheetExportRepository.upsertExport({
            conversationId,
            sheetTabName: tabName,
            sheetRowNumber,
            exportStatus: 'updated',
            finalStatus,
            idempotencyKey,
            exportedAt: new Date(),
            lastSyncAt: new Date(),
          });
        }
      }
      classificationMetricsService.recordSheetOperation('update');
      classificationLoggingService.logSheetOperation({
        conversationId,
        sheetOperation: 'update',
        sheetRow: sheetRowNumber,
        success: !res.skipped,
        reason: res.reason || null,
      });
      return { ...res, operation: 'update', sheetRow: sheetRowNumber };
    }

    if (
      existing
      && !escalation
      && config.conversationClassificationSheetUpdateEnabled
    ) {
      classificationMetricsService.recordSheetOperation('append', { duplicatePrevented: true });
      classificationLoggingService.logSheetOperation({
        conversationId,
        sheetOperation: 'append',
        duplicatePrevented: true,
        success: true,
        reason: 'already_exported_pending_row',
      });
      return {
        skipped: true,
        reason: 'already_exported_pending_row',
        operation: 'append',
        duplicatePrevented: true,
      };
    }

    const res = await googleSheetsService.appendConversationRow(row, { headers });
    const appendedRowNumber = parseRowNumberFromUpdatedRange(res.updatedRange);

    if (conversationSheetExportRepository.isEnabled() && conversationId && !res.skipped) {
      await conversationSheetExportRepository.upsertExport({
        conversationId,
        sheetTabName: tabName,
        sheetRowNumber: appendedRowNumber,
        exportStatus: 'appended',
        finalStatus,
        idempotencyKey,
        exportedAt: new Date(),
        lastSyncAt: new Date(),
      });
    }

    classificationMetricsService.recordSheetOperation('append');
    classificationLoggingService.logSheetOperation({
      conversationId,
      sheetOperation: 'append',
      sheetRow: appendedRowNumber,
      success: !res.skipped,
      reason: res.reason || null,
    });

    return { ...res, operation: 'append', sheetRow: appendedRowNumber };
  }
}

const conversationSheetExportService = new ConversationSheetExportService();
export default conversationSheetExportService;
export { CONVERSATION_ID_COLUMN_HEADER };
