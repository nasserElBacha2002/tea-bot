import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import conversationSheetExportService from './conversationSheetExport.service.js';
import googleSheetsService from './googleSheets.service.js';
import { GoogleSheetsMockStore } from '../testing/google-sheets-mock.store.js';
import { CONVERSATION_ID_COLUMN_HEADER } from './conversationSheetFormatter.service.js';

const sharedStore = new GoogleSheetsMockStore();

function installMockSheets() {
  const prevEnabled = config.googleSheetsEnabled;
  config.googleSheetsEnabled = true;
  config.googleSheetsTabName = 'Conversaciones';
  config.googleSheetsSpreadsheetId = 'mock-sheet';
  config.googleServiceAccountEmail = 'mock@test';
  config.googlePrivateKey = 'mock';
  config.conversationClassificationSheetUpdateEnabled = true;

  googleSheetsService.isEnabled = () => true;
  googleSheetsService.hasRequiredConfig = () => true;
  googleSheetsService.readTabValues = async (tab) => sharedStore.readTabValues(tab);
  googleSheetsService.appendConversationRow = async (row, opts = {}) => sharedStore.appendRow(
    opts.tabName || config.googleSheetsTabName,
    row,
    { headers: opts.headers || [] },
  );
  googleSheetsService.updateManagedCells = async (tab, headers, rowNum, updates) => sharedStore.updateManagedCells(
    tab,
    headers,
    rowNum,
    updates,
  );

  return () => {
    config.googleSheetsEnabled = prevEnabled;
  };
}

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  try {
    const ping = await pingDatabase();
    if (!ping.ok) return 'Conversation DB unavailable';
  } catch (error) {
    return `Conversation DB unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}

async function createConversation(suffix) {
  return conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `sheet-exp-${suffix}`,
    phoneNumber: `+54911${suffix}`,
    displayName: `Export ${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });
}

test('syncFormattedRow — dos workers concurrentes dejan una sola fila física', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);

  sharedStore.tabs.clear();
  sharedStore.appendCalls = 0;
  const headers = [CONVERSATION_ID_COLUMN_HEADER, 'Consulta principal', 'Observaciones'];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);
  sharedStore.tabs.get(config.googleSheetsTabName).rows.push(['old', 'admin', 'NO TOCAR']);

  const conversation = await createConversation(`${Date.now()}`);
  const row = [conversation.id, 'Carreras a distancia', ''];

  let releaseBarrier;
  const barrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });
  sharedStore.setAppendBarrier(barrier);

  const workerA = conversationSheetExportService.syncFormattedRow({
    conversationId: conversation.id,
    finalStatus: 'completed',
    headers,
    row,
    workerId: 'worker-a',
  });
  const workerB = conversationSheetExportService.syncFormattedRow({
    conversationId: conversation.id,
    finalStatus: 'completed',
    headers,
    row: [conversation.id, 'Duplicado', ''],
    workerId: 'worker-b',
  });

  await new Promise((r) => setTimeout(r, 30));
  releaseBarrier();
  const [resA, resB] = await Promise.all([workerA, workerB]);

  const physical = sharedStore.countRowsForConversation(config.googleSheetsTabName, conversation.id);
  assert.equal(physical, 1, 'debe existir una sola fila física');
  assert.equal(sharedStore.appendCalls, 1, 'un solo append');

  const exported = [resA, resB].filter((r) => r.exported);
  assert.equal(exported.length, 1);
  const ledger = await conversationSheetExportRepository.findLatestByConversationAndTab(
    conversation.id,
    config.googleSheetsTabName,
  );
  assert.ok(ledger?.sheetRowNumber);
  assert.equal(ledger.coordinatorState, 'confirmed');
  const adminRow = sharedStore.getRow(config.googleSheetsTabName, 2);
  assert.equal(adminRow?.[2], 'NO TOCAR');
});

test('syncFormattedRow — estado ambiguo con fila física única se reconcilia sin append', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);

  sharedStore.tabs.clear();
  const headers = [CONVERSATION_ID_COLUMN_HEADER, 'Consulta principal'];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);
  const conversation = await createConversation(`${Date.now()}`);
  const row = [conversation.id, 'Licenciatura'];
  sharedStore.appendRow(config.googleSheetsTabName, row, { headers });

  await conversationSheetExportRepository.upsertExport({
    conversationId: conversation.id,
    sheetTabName: config.googleSheetsTabName,
    sheetRowNumber: null,
    exportStatus: 'ambiguous',
    finalStatus: 'completed',
    idempotencyKey: `conversation:${conversation.id}:primary`,
    exportedAt: new Date(),
    lastSyncAt: new Date(),
  });
  const ledger = await conversationSheetExportRepository.findLatestByConversationAndTab(
    conversation.id,
    config.googleSheetsTabName,
  );
  await conversationSheetExportRepository.markCoordinatorAmbiguous(ledger.id);

  const res = await conversationSheetExportService.syncFormattedRow({
    conversationId: conversation.id,
    finalStatus: 'completed',
    headers,
    row,
    workerId: 'ambiguous-recover',
  });

  assert.equal(res.exported, true);
  assert.equal(res.operation, 'reconcile');
  assert.equal(sharedStore.countRowsForConversation(config.googleSheetsTabName, conversation.id), 1);
  const after = await conversationSheetExportRepository.findLatestByConversationAndTab(
    conversation.id,
    config.googleSheetsTabName,
  );
  assert.equal(after.coordinatorState, 'confirmed');
  assert.equal(after.sheetRowNumber, 2);
});

test('syncFormattedRow — estado ambiguo sin fila física aborta sin append ciego', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);

  sharedStore.tabs.clear();
  const headers = [CONVERSATION_ID_COLUMN_HEADER, 'Consulta principal'];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);
  const conversation = await createConversation(`no-row-${Date.now()}`);

  await conversationSheetExportRepository.upsertExport({
    conversationId: conversation.id,
    sheetTabName: config.googleSheetsTabName,
    sheetRowNumber: null,
    exportStatus: 'ambiguous',
    finalStatus: 'completed',
    idempotencyKey: `conversation:${conversation.id}:primary`,
    exportedAt: new Date(),
    lastSyncAt: new Date(),
  });
  const ledger = await conversationSheetExportRepository.findLatestByConversationAndTab(
    conversation.id,
    config.googleSheetsTabName,
  );
  await conversationSheetExportRepository.markCoordinatorAmbiguous(ledger.id);

  const beforeAppends = sharedStore.appendCalls;
  const res = await conversationSheetExportService.syncFormattedRow({
    conversationId: conversation.id,
    finalStatus: 'completed',
    headers,
    row: [conversation.id, 'Sin fila'],
    workerId: 'ambiguous-no-row',
  });

  assert.equal(res.exported, false);
  assert.equal(res.outcome, 'ambiguous_write');
  assert.equal(sharedStore.appendCalls, beforeAppends);
});