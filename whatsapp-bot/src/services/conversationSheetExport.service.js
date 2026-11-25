import { config } from '../config.js';
import googleSheetsService, { columnToLetter } from './googleSheets.service.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import classificationLoggingService from './conversationClassification/classificationLogging.service.js';
import classificationMetricsService from './conversationClassification/classificationMetrics.service.js';
import { CONVERSATION_ID_COLUMN_HEADER, MANAGED_SHEET_COLUMN_HEADERS } from './conversationSheetFormatter.service.js';
import {
  resolveSheetRowByConversationId,
  validateStoredSheetRow,
} from './sheet-row-identity.service.js';
import {
  decideSheetExportAction,
  findDuplicateHeaders,
  mapRowValuesToSheetHeaders,
} from './conversation-sheet-export.logic.js';
import { SHEET_EXPORT_OUTCOMES } from './sheet-export-outcome.js';
import { buildUniqueAcquisitionId } from '../utils/sheet-worker-id.js';

function parseRowNumberFromUpdatedRange(updatedRange) {
  const match = String(updatedRange || '').match(/![A-Z]+(\d+)(?::|$)/i);
  return match ? Number(match[1]) : null;
}

function buildIdempotencyKey(conversationId, finalStatus, escalation = false) {
  if (!conversationId) return `session:${finalStatus}:${Date.now()}`;
  if (escalation) return `conversation:${conversationId}:escalation:${finalStatus}`;
  return `conversation:${conversationId}:primary`;
}

function buildFailureResult(outcome, reason, extra = {}) {
  return {
    skipped: true,
    exported: false,
    outcome,
    reason,
    ...extra,
  };
}

function buildManagedUpdates(headers, row) {
  const updates = {};
  for (const header of MANAGED_SHEET_COLUMN_HEADERS) {
    const idx = headers.indexOf(header);
    if (idx < 0 || idx >= row.length) continue;
    updates[header] = row[idx];
  }
  if (headers.includes(CONVERSATION_ID_COLUMN_HEADER)) {
    const cidIdx = headers.indexOf(CONVERSATION_ID_COLUMN_HEADER);
    if (cidIdx >= 0 && cidIdx < row.length) {
      updates[CONVERSATION_ID_COLUMN_HEADER] = row[cidIdx];
    }
  }
  return updates;
}

class ConversationSheetExportService {
  async tryRecoverAmbiguousCoordinator({
    conversationId,
    tabName,
    blockedRecord,
    finalStatus,
    headers,
  }) {
    if (!blockedRecord?.id || blockedRecord.coordinatorState !== 'ambiguous') {
      return { recovered: false, reason: 'not_ambiguous' };
    }
    const { headers: sheetHeaders, dataRows } = await this._readSheetContext(tabName, headers);
    const resolved = resolveSheetRowByConversationId(sheetHeaders, dataRows, conversationId);
    if (resolved.status === 'duplicate') {
      classificationLoggingService.logSheetOperation({
        conversationId,
        sheetOperation: 'reconcile',
        success: false,
        reason: 'duplicate_conversation_id_rows',
        outcome: SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT,
      });
      return { recovered: false, reason: 'duplicate_rows', conflict: true };
    }
    if (resolved.status !== 'unique' || !resolved.sheetRow) {
      return { recovered: false, reason: 'row_not_determined' };
    }
    const reconciled = await conversationSheetExportRepository.reconcileAmbiguousCoordinator(
      blockedRecord.id,
      {
        sheetRowNumber: resolved.sheetRow,
        exportStatus: 'reconciled',
        finalStatus,
        exportedAt: new Date(),
        lastSyncAt: new Date(),
      },
    );
    if (!reconciled) {
      return { recovered: false, reason: 'reconcile_rejected' };
    }
    return {
      recovered: true,
      sheetRow: resolved.sheetRow,
      ledger: reconciled,
    };
  }

  async findExistingExport(conversationId, tabName) {
    if (!conversationSheetExportRepository.isEnabled() || !conversationId) return null;
    return conversationSheetExportRepository.findLatestByConversationAndTab(conversationId, tabName);
  }

  async _readSheetContext(tabName, fallbackHeaders = []) {
    const values = await googleSheetsService.readTabValues(tabName);
    const headers = values[0]?.length ? values[0] : fallbackHeaders;
    const dataRows = values.slice(1);
    return { headers, dataRows };
  }

  async resolveSheetRowNumber(conversationId, headers, dataRows, existing) {
    const resolved = resolveSheetRowByConversationId(headers, dataRows, conversationId);
    if (resolved.status === 'duplicate' || resolved.status === 'missing_column') {
      return { rowNumber: null, resolved };
    }

    if (existing?.sheetRowNumber) {
      const validation = validateStoredSheetRow(
        headers,
        dataRows,
        existing.sheetRowNumber,
        conversationId,
      );
      if (validation.valid) {
        return { rowNumber: existing.sheetRowNumber, resolved: { status: 'unique', sheetRow: existing.sheetRowNumber } };
      }
    }

    const rowNumber = resolved.status === 'unique' ? resolved.sheetRow : null;
    if (rowNumber && existing?.id) {
      await conversationSheetExportRepository.updateExport(existing.id, { sheetRowNumber: rowNumber });
    }
    return { rowNumber, resolved };
  }

  async syncFormattedRow({
    conversationId,
    finalStatus,
    headers,
    row,
    escalation = false,
    workerId = buildUniqueAcquisitionId('sheet-export'),
  }) {
    const tabName = config.googleSheetsTabName;
    const idempotencyKey = buildIdempotencyKey(conversationId, finalStatus, escalation);

    if (!googleSheetsService.isEnabled()) {
      return buildFailureResult(SHEET_EXPORT_OUTCOMES.INTENTIONALLY_DISABLED, 'disabled');
    }
    if (!googleSheetsService.hasRequiredConfig()) {
      return buildFailureResult(SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR, 'missing_config');
    }

    let coordinatorRecord = null;
    if (conversationId && conversationSheetExportRepository.isEnabled()) {
      const acquire = await conversationSheetExportRepository.acquireCoordinator({
        conversationId,
        sheetTabName: tabName,
        idempotencyKey,
        ownerId: workerId,
      });
      if (!acquire.acquired) {
        if (acquire.reason === 'ambiguous') {
          const recovery = await this.tryRecoverAmbiguousCoordinator({
            conversationId,
            tabName,
            blockedRecord: acquire.record,
            finalStatus,
            headers,
          });
          if (recovery.recovered) {
            return {
              skipped: false,
              exported: true,
              outcome: SHEET_EXPORT_OUTCOMES.CONFIRMED,
              operation: 'reconcile',
              sheetRow: recovery.sheetRow,
              ambiguousRecovered: true,
            };
          }
          if (recovery.conflict) {
            return buildFailureResult(SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT, 'duplicate_rows');
          }
          return buildFailureResult(SHEET_EXPORT_OUTCOMES.AMBIGUOUS_WRITE, 'coordinator_ambiguous');
        }
        if (acquire.reason === 'in_progress') {
          return buildFailureResult(
            SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED,
            'export_in_progress',
            { duplicatePrevented: true },
          );
        }
        if (acquire.reason === 'already_confirmed' && acquire.record?.sheetRowNumber) {
          coordinatorRecord = acquire.record;
        } else {
          return buildFailureResult(
            SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED,
            acquire.reason,
            { duplicatePrevented: true },
          );
        }
      } else {
        coordinatorRecord = acquire.record;
        const owned = await conversationSheetExportRepository.markCoordinatorInProgress(
          coordinatorRecord.id,
          workerId,
        );
        if (!owned) {
          return buildFailureResult(
            SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED,
            'coordinator_not_owned',
            { duplicatePrevented: true },
          );
        }
        coordinatorRecord = owned;
      }
    }

    const existing = coordinatorRecord
      || (conversationId ? await this.findExistingExport(conversationId, tabName) : null);

    const { headers: sheetHeaders, dataRows } = await this._readSheetContext(tabName, headers);
    const duplicateHeaders = findDuplicateHeaders(sheetHeaders);
    if (duplicateHeaders.length > 0) {
      if (coordinatorRecord?.id) {
        await conversationSheetExportRepository.releaseCoordinator(coordinatorRecord.id, workerId);
      }
      return buildFailureResult(
        SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT,
        'duplicate_headers',
        { duplicateHeaders },
      );
    }
    const { rowNumber, resolved } = await this.resolveSheetRowNumber(
      conversationId,
      sheetHeaders,
      dataRows,
      existing,
    );

    const storedValidation = existing?.sheetRowNumber
      ? validateStoredSheetRow(sheetHeaders, dataRows, existing.sheetRowNumber, conversationId)
      : { valid: false };
    const decision = decideSheetExportAction({
      resolved,
      existingLedger: existing,
      escalation,
      updateEnabled: config.conversationClassificationSheetUpdateEnabled,
      storedRowValid: storedValidation.valid,
      storedRowNumber: existing?.sheetRowNumber || rowNumber || null,
    });

    if (decision.action === 'abort' || decision.action === 'skip') {
      if (coordinatorRecord?.id) {
        await conversationSheetExportRepository.releaseCoordinator(coordinatorRecord.id, workerId);
      }
      classificationLoggingService.logSheetOperation({
        conversationId,
        sheetOperation: decision.action,
        success: false,
        reason: decision.reason,
        outcome: decision.outcome,
      });
      return buildFailureResult(decision.outcome, decision.reason, {
        operation: decision.action,
        duplicatePrevented: decision.outcome === SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED,
      });
    }

    if (decision.action === 'update') {
      const managed = buildManagedUpdates(headers, row);
      const res = await googleSheetsService.updateManagedCells(
        tabName,
        sheetHeaders,
        decision.sheetRow,
        managed,
      );
      if (res.skipped) {
        if (coordinatorRecord?.id) {
          await conversationSheetExportRepository.releaseCoordinator(coordinatorRecord.id, workerId);
        }
        return buildFailureResult(SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR, res.reason);
      }
      if (conversationSheetExportRepository.isEnabled() && conversationId && coordinatorRecord?.id) {
        const confirmed = await conversationSheetExportRepository.confirmCoordinator(coordinatorRecord.id, {
          sheetRowNumber: decision.sheetRow,
          exportStatus: 'updated',
          finalStatus,
          exportedAt: new Date(),
          lastSyncAt: new Date(),
        }, workerId);
        if (!confirmed) {
          return buildFailureResult(SHEET_EXPORT_OUTCOMES.DUPLICATE_PREVENTED, 'coordinator_confirm_rejected');
        }
      }
      const outcome = escalation
        ? SHEET_EXPORT_OUTCOMES.ESCALATION_CONFIRMED
        : SHEET_EXPORT_OUTCOMES.CONFIRMED;
      classificationMetricsService.recordSheetOperation('update');
      classificationLoggingService.logSheetOperation({
        conversationId,
        sheetOperation: 'update',
        sheetRow: decision.sheetRow,
        success: true,
        outcome,
      });
      return { skipped: false, exported: true, operation: 'update', sheetRow: decision.sheetRow, outcome };
    }

    const appendRow = mapRowValuesToSheetHeaders(sheetHeaders, headers, row);
    let res;
    try {
      res = await googleSheetsService.appendConversationRow(appendRow, { headers: sheetHeaders });
    } catch (error) {
      if (coordinatorRecord?.id) {
        await conversationSheetExportRepository.markCoordinatorAmbiguous(coordinatorRecord.id, workerId);
      }
      const timeout = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(String(error?.code || ''));
      return buildFailureResult(
        timeout ? SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR : SHEET_EXPORT_OUTCOMES.AMBIGUOUS_WRITE,
        error?.message || 'append_failed',
      );
    }
    const appendedRowNumber = parseRowNumberFromUpdatedRange(res.updatedRange);

    if (!appendedRowNumber) {
      const afterAppend = await this._readSheetContext(tabName, headers);
      const afterResolved = resolveSheetRowByConversationId(
        afterAppend.headers,
        afterAppend.dataRows,
        conversationId,
      );
      if (afterResolved.status === 'unique') {
        if (coordinatorRecord?.id) {
          const confirmed = await conversationSheetExportRepository.confirmCoordinator(coordinatorRecord.id, {
            sheetRowNumber: afterResolved.sheetRow,
            exportStatus: 'reconciled',
            finalStatus,
            exportedAt: new Date(),
            lastSyncAt: new Date(),
          }, workerId);
          if (!confirmed) {
            return buildFailureResult(SHEET_EXPORT_OUTCOMES.AMBIGUOUS_WRITE, 'coordinator_confirm_rejected');
          }
        }
        return {
          skipped: false,
          exported: true,
          outcome: SHEET_EXPORT_OUTCOMES.CONFIRMED,
          operation: 'reconcile',
          sheetRow: afterResolved.sheetRow,
          ambiguousRecovered: true,
        };
      }
      if (coordinatorRecord?.id) {
        await conversationSheetExportRepository.markCoordinatorAmbiguous(coordinatorRecord.id, workerId);
      }
      return buildFailureResult(SHEET_EXPORT_OUTCOMES.AMBIGUOUS_WRITE, 'append_response_lost');
    }

    if (conversationSheetExportRepository.isEnabled() && conversationId && !res.skipped && coordinatorRecord?.id) {
      const confirmed = await conversationSheetExportRepository.confirmCoordinator(coordinatorRecord.id, {
        sheetRowNumber: appendedRowNumber,
        exportStatus: 'appended',
        finalStatus,
        exportedAt: new Date(),
        lastSyncAt: new Date(),
      }, workerId);
      if (!confirmed) {
        return buildFailureResult(SHEET_EXPORT_OUTCOMES.AMBIGUOUS_WRITE, 'coordinator_confirm_rejected');
      }
    }

    classificationMetricsService.recordSheetOperation('append');
    classificationLoggingService.logSheetOperation({
      conversationId,
      sheetOperation: 'append',
      sheetRow: appendedRowNumber,
      success: !res.skipped,
      outcome: SHEET_EXPORT_OUTCOMES.CONFIRMED,
    });

    return {
      ...res,
      skipped: false,
      exported: true,
      operation: 'append',
      sheetRow: appendedRowNumber,
      outcome: escalation ? SHEET_EXPORT_OUTCOMES.ESCALATION_CONFIRMED : SHEET_EXPORT_OUTCOMES.CONFIRMED,
    };
  }
}

const conversationSheetExportService = new ConversationSheetExportService();
export default conversationSheetExportService;
export { CONVERSATION_ID_COLUMN_HEADER, SHEET_EXPORT_OUTCOMES, buildIdempotencyKey };