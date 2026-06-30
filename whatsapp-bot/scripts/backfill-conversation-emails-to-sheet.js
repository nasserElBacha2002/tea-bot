#!/usr/bin/env node
import '../src/config.js';
import conversationSheetSyncService from '../src/services/conversationSheetSync.service.js';

const dryRun = process.argv.includes('--dry-run');

try {
  const stats = await conversationSheetSyncService.backfillConversationEmails({ dryRun });
  if (stats.skipped) {
    process.exit(2);
  }
  process.exit(stats.errors > 0 ? 1 : 0);
} catch (error) {
  console.error('[SheetEmailBackfill] fatal', error.message);
  process.exit(1);
}
