import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase, query } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import conversationExportService from './conversationExport.service.js';
import sessionService from './session.service.js';
import googleSheetsService from './googleSheets.service.js';
import { GoogleSheetsMockStore } from '../testing/google-sheets-mock.store.js';
import { CONVERSATION_ID_COLUMN_HEADER } from './conversationSheetFormatter.service.js';

const sharedStore = new GoogleSheetsMockStore();

function installMockSheets() {
  const prevEnabled = config.googleSheetsEnabled;
  config.googleSheetsEnabled = true;
  config.googleSheetsTabName = 'Conversaciones';
  config.googleSheetsSpreadsheetId = 'mock-hist';
  config.googleServiceAccountEmail = 'mock@test';
  config.googlePrivateKey = 'mock';
  config.conversationClassificationMode = 'legacy';
  config.googleSheetsRawTabName = '';

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
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

test('exportación histórica no altera sesión runtime activa del mismo contacto', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);

  const phone = `+54911${String(Date.now()).slice(-7)}`;
  const suffix = Date.now();
  const userActive = `twilio:whatsapp:${phone}`;

  const closedConv = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `closed-${suffix}`,
    phoneNumber: phone,
    displayName: 'Cerrada',
    status: 'closed',
    currentFlowId: 'main-menu',
    currentNodeKey: 'closed_node',
  });
  const activeConv = await conversationRepository.createConversation({
    channel: 'whatsapp',
    provider: 'twilio',
    externalUserId: `active-${suffix}`,
    phoneNumber: phone,
    displayName: 'Activa',
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
  });

  await conversationSessionRepository.createSession({
    conversationId: closedConv.id,
    flowId: 'main-menu',
    flowVersion: 'v1',
    currentNodeKey: 'closed_node',
    trackingJson: {
      visitedNodes: ['welcome', 'closed_path_only'],
      answers: { rama: 'cerrada' },
    },
    status: 'ended',
  });

  await sessionService.createSession(userActive, 'main-menu', 'welcome', {
    provider: 'twilio',
    phone,
    visitedNodes: ['welcome', 'active_path_only'],
    answers: { rama: 'activa' },
    conversationId: activeConv.id,
  });

  const before = sessionService.getSession(userActive);
  assert.deepEqual(before?.visitedNodes, ['welcome', 'active_path_only']);

  sharedStore.tabs.clear();
  const headers = [CONVERSATION_ID_COLUMN_HEADER, 'Consulta principal'];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);

  const res = await conversationExportService.exportFinalizedConversation(
    userActive,
    'completed',
    {
      conversationId: closedConv.id,
      exportHistorical: true,
      flowId: 'main-menu',
      flowVersion: 'v1',
      channel: 'whatsapp',
    },
  );

  assert.equal(res.exported, true);

  const after = sessionService.getSession(userActive);
  assert.deepEqual(after?.visitedNodes, ['welcome', 'active_path_only']);
  assert.equal(after?.exportedAt, before?.exportedAt);
  assert.equal(after?.answers?.rama, 'activa');

  assert.equal(res.outcome, 'confirmed');
  assert.ok(sharedStore.appendCalls >= 1, 'debe persistir exportación histórica en planilla mock');

  t.after(async () => {
    await sessionService.resetSession(userActive);
    await query('DELETE FROM dbo.conversation_sessions WHERE conversation_id IN ($1, $2)', [closedConv.id, activeConv.id]);
    await query('DELETE FROM dbo.conversations WHERE id IN ($1, $2)', [closedConv.id, activeConv.id]);
  });
});

test('exportación histórica sin contexto persistido aborta sin escribir', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);

  const closedConv = await conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `no-ctx-${Date.now()}`,
    phoneNumber: `+54911${String(Date.now()).slice(-6)}`,
    displayName: 'Sin tracking',
    status: 'closed',
    currentFlowId: 'main-menu',
    currentNodeKey: 'x',
  });

  sharedStore.tabs.clear();
  const headers = [CONVERSATION_ID_COLUMN_HEADER, 'Consulta principal'];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);
  const beforeAppends = sharedStore.appendCalls;

  const res = await conversationExportService.exportFinalizedConversation(
    `user:no-ctx-${closedConv.id}`,
    'completed',
    {
      conversationId: closedConv.id,
      exportHistorical: true,
      flowId: 'main-menu',
      flowVersion: 'v1',
      channel: 'simulator',
    },
  );

  assert.equal(res.exported, false);
  assert.equal(res.outcome, 'historical_context_missing');
  assert.equal(sharedStore.appendCalls, beforeAppends);

  t.after(async () => {
    await query('DELETE FROM dbo.conversations WHERE id = $1', [closedConv.id]);
  });
});