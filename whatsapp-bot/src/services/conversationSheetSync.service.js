import { config } from '../config.js';
import googleSheetsService, { columnToLetter } from './googleSheets.service.js';
import conversationSheetFormatterService, {
  CONVERSATION_ID_COLUMN_HEADER,
  EMAIL_COLUMN_HEADER,
  MANAGED_SHEET_COLUMN_HEADERS,
  buildClassificationColumns,
  findSheetRowMatch,
  formatContactEmailForSheet,
} from './conversationSheetFormatter.service.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import classificationReconciliationService from './conversationClassification/classificationReconciliation.service.js';
import { formatDetalleForExport } from './conversationClassification/classificationResolver.service.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';

function resolveEmail(conversation) {
  const email = conversation?.contactEmail;
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

function isSameSheetEmail(currentValue, email) {
  const left = String(currentValue || '').trim().toLowerCase();
  const right = String(email || '').trim().toLowerCase();
  if (!right) return true;
  if (!left || left === '—') return false;
  return left === right;
}

class ConversationSheetSyncService {
  async syncEmailForConversation(conversation, options = {}) {
    if (!googleSheetsService.isEnabled()) {
      return { skipped: true, reason: 'disabled' };
    }
    if (!googleSheetsService.hasRequiredConfig()) {
      return {
        skipped: true,
        reason: 'missing_config',
        missingKeys: googleSheetsService.missingConfigKeys(),
      };
    }

    const email = resolveEmail(conversation);
    if (!email) {
      return { skipped: true, reason: 'no_email' };
    }

    const tabName = config.googleSheetsTabName;
    const expectedHeaders = conversationSheetFormatterService.humanHeaders();
    const sheetContext = options.sheetContext;

    let headers;
    let dataRows;
    let emailColumnIndex;

    if (sheetContext) {
      headers = sheetContext.headers;
      dataRows = sheetContext.dataRows;
      emailColumnIndex = headers.indexOf(EMAIL_COLUMN_HEADER);
    } else {
      const ensured = await googleSheetsService.ensureHeaderColumns(tabName, expectedHeaders);
      headers = ensured.headers;
      emailColumnIndex = ensured.emailColumnIndex;
      const values = await googleSheetsService.readTabValues(tabName);
      dataRows = values.slice(1);
    }

    if (emailColumnIndex < 0) {
      return { skipped: true, reason: 'email_column_missing' };
    }

    const sheetRow = findSheetRowMatch(headers, dataRows, {
      phoneNumber: conversation.phoneNumber,
      startedAt: conversation.startedAt,
      closedAt: conversation.closedAt,
      lastMessageAt: conversation.lastMessageAt,
      conversationId: conversation.id,
    });

    if (!sheetRow) {
      return {
        skipped: true,
        reason: 'row_not_found',
        conversationId: conversation.id,
        phoneNumber: conversation.phoneNumber,
      };
    }

    const currentValue = dataRows[sheetRow - 2]?.[emailColumnIndex];
    if (isSameSheetEmail(currentValue, email)) {
      return {
        skipped: true,
        reason: 'already_set',
        conversationId: conversation.id,
        sheetRow,
      };
    }

    const cell = `${columnToLetter(emailColumnIndex)}${sheetRow}`;
    if (options.dryRun) {
      return {
        skipped: false,
        dryRun: true,
        updated: true,
        conversationId: conversation.id,
        sheetRow,
        cell,
        email: formatContactEmailForSheet(email),
      };
    }

    await googleSheetsService.updateCell(tabName, cell, email);
    if (dataRows[sheetRow - 2]) {
      dataRows[sheetRow - 2][emailColumnIndex] = email;
    }

    return {
      skipped: false,
      updated: true,
      conversationId: conversation.id,
      sheetRow,
      cell,
      email,
    };
  }

  async syncClassificationForConversation(conversation, options = {}) {
    if (!config.conversationClassificationSheetUpdateEnabled) {
      return { skipped: true, reason: 'sheet_update_disabled' };
    }
    if (!googleSheetsService.isEnabled() || !googleSheetsService.hasRequiredConfig()) {
      return { skipped: true, reason: 'disabled_or_missing_config' };
    }

    const dbSession = await conversationSessionRepository.findLatestByConversationId(conversation.id);
    const session = classificationReconciliationService.buildSessionFromDbSession(conversation, dbSession);
    const resolution = await classificationReconciliationService.classifySessionForExport(
      session,
      conversation.id,
      { persist: true },
    );
    const exportClassification = resolution.exportClassification;
    if (!exportClassification?.primaryQuery) {
      return { skipped: true, reason: 'no_classification' };
    }
    if (exportClassification.source === 'manual') {
      return { skipped: true, reason: 'manual_override' };
    }

    const tabName = config.googleSheetsTabName;
    const expectedHeaders = conversationSheetFormatterService.humanHeaders();
    const ensured = await googleSheetsService.ensureHeaderColumns(tabName, expectedHeaders);
    const values = await googleSheetsService.readTabValues(tabName);
    const headers = ensured.headers.length > 0 ? ensured.headers : (values[0] || expectedHeaders);
    const dataRows = values.slice(1);

    let sheetRow = null;
    const exportRecord = conversationSheetExportRepository.isEnabled()
      ? await conversationSheetExportRepository.findLatestByConversationAndTab(conversation.id, tabName)
      : null;
    if (exportRecord?.sheetRowNumber) {
      sheetRow = exportRecord.sheetRowNumber;
    }
    if (!sheetRow) {
      sheetRow = findSheetRowMatch(headers, dataRows, {
        phoneNumber: conversation.phoneNumber,
        startedAt: conversation.startedAt,
        closedAt: conversation.closedAt,
        lastMessageAt: conversation.lastMessageAt,
        conversationId: conversation.id,
      });
    }
    if (!sheetRow) {
      return { skipped: true, reason: 'row_not_found', conversationId: conversation.id };
    }

    const detalle = formatDetalleForExport(exportClassification);
    const extendedValues = buildClassificationColumns(exportClassification, conversation.id);
    const extendedHeaders = conversationSheetFormatterService.humanHeaders().slice(-extendedValues.length);
    const updates = {
      'Consulta principal': exportClassification.primaryQuery || 'No informado',
      'Detalle de consulta': detalle,
    };
    extendedHeaders.forEach((header, index) => {
      updates[header] = extendedValues[index];
    });

    const cells = [];
    for (const header of MANAGED_SHEET_COLUMN_HEADERS) {
      if (!(header in updates)) continue;
      const idx = headers.indexOf(header);
      if (idx < 0) continue;
      cells.push({
        cell: `${columnToLetter(idx)}${sheetRow}`,
        value: updates[header],
      });
    }

    if (options.dryRun) {
      return {
        skipped: false,
        dryRun: true,
        updated: true,
        conversationId: conversation.id,
        sheetRow,
        cells,
      };
    }

    for (const item of cells) {
      await googleSheetsService.updateCell(tabName, item.cell, item.value);
    }

    return {
      skipped: false,
      updated: true,
      conversationId: conversation.id,
      sheetRow,
      primaryQuery: exportClassification.primaryQuery,
    };
  }

  async backfillConversationEmails(options = {}) {
    const dryRun = Boolean(options.dryRun);
    const tabName = config.googleSheetsTabName;

    if (!googleSheetsService.isEnabled()) {
      console.log('[SheetEmailBackfill] skipped: Google Sheets disabled');
      return { skipped: true, reason: 'disabled' };
    }
    if (!googleSheetsService.hasRequiredConfig()) {
      console.log('[SheetEmailBackfill] skipped: missing config', googleSheetsService.missingConfigKeys());
      return { skipped: true, reason: 'missing_config' };
    }

    const { default: conversationRepository } = await import('../repositories/conversation.repository.js');
    if (!conversationRepository.isEnabled()) {
      console.log('[SheetEmailBackfill] skipped: conversation DB disabled');
      return { skipped: true, reason: 'db_disabled' };
    }

    const expectedHeaders = conversationSheetFormatterService.humanHeaders();
    const ensured = await googleSheetsService.ensureHeaderColumns(tabName, expectedHeaders);
    const values = await googleSheetsService.readTabValues(tabName);
    const sheetContext = {
      headers: ensured.headers.length > 0 ? ensured.headers : (values[0] || expectedHeaders),
      dataRows: values.slice(1),
    };

    const stats = {
      total: 0,
      updated: 0,
      alreadySet: 0,
      notFound: 0,
      skipped: 0,
      errors: 0,
      dryRun,
    };

    const batchSize = 100;
    let offset = 0;

    console.log(`[SheetEmailBackfill] start dryRun=${dryRun}`);

    while (true) {
      const batch = await conversationRepository.listConversationsWithContactEmail({
        limit: batchSize,
        offset,
      });
      if (batch.length === 0) break;

      for (const conversation of batch) {
        stats.total += 1;
        try {
          const result = await this.syncEmailForConversation(conversation, {
            dryRun,
            sheetContext,
          });
          if (result.updated) {
            stats.updated += 1;
            console.log(
              `[SheetEmailBackfill] ${dryRun ? 'would_update' : 'updated'} conversationId=${conversation.id} row=${result.sheetRow} email=${result.email}`,
            );
          } else if (result.reason === 'already_set') {
            stats.alreadySet += 1;
          } else if (result.reason === 'row_not_found') {
            stats.notFound += 1;
            console.warn(
              `[SheetEmailBackfill] not_found conversationId=${conversation.id} phone=${conversation.phoneNumber || '—'}`,
            );
          } else {
            stats.skipped += 1;
          }
        } catch (error) {
          stats.errors += 1;
          console.error(
            `[SheetEmailBackfill] error conversationId=${conversation.id}: ${error.message}`,
          );
        }
      }

      offset += batch.length;
    }

    console.log('[SheetEmailBackfill] summary', JSON.stringify(stats));
    return stats;
  }
}

const conversationSheetSyncService = new ConversationSheetSyncService();
export default conversationSheetSyncService;
