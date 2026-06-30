import { config } from '../config.js';
import googleSheetsService, { columnToLetter } from './googleSheets.service.js';
import conversationSheetFormatterService, {
  EMAIL_COLUMN_HEADER,
  findSheetRowMatch,
  formatContactEmailForSheet,
} from './conversationSheetFormatter.service.js';

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
