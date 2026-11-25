import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSheetSyncJobRepository from '../repositories/conversation-sheet-sync-job.repository.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import googleSheetsService from './googleSheets.service.js';
import { GoogleSheetsMockStore } from '../testing/google-sheets-mock.store.js';
import { EMAIL_COLUMN_HEADER, CONVERSATION_ID_COLUMN_HEADER } from './conversationSheetFormatter.service.js';
import {
  enqueueEmailSheetSync,
  runDueSheetSyncJobs,
  emailPayloadHash,
} from './conversation-sheet-sync-recovery.service.js';
import { saveContactEmailForConversation } from './contact-email.service.js';
import { buildSheetWorkerId } from '../utils/sheet-worker-id.js';

const sharedStore = new GoogleSheetsMockStore();
let writeBarrier = null;
let writeBarrierRelease = null;
let updateCellCalls = 0;

function installMockSheets() {
  const prevEnabled = config.googleSheetsEnabled;
  config.googleSheetsEnabled = true;
  config.googleSheetsTabName = 'Conversaciones';
  config.googleSheetsSpreadsheetId = 'mock-sync';
  config.googleServiceAccountEmail = 'mock@test';
  config.googlePrivateKey = 'mock';
  updateCellCalls = 0;

  googleSheetsService.isEnabled = () => true;
  googleSheetsService.hasRequiredConfig = () => true;
  googleSheetsService.ensureHeaderColumns = async (tab, headers) => {
    const tabState = sharedStore.ensureTab(tab, headers);
    return { headers: tabState.headers, emailColumnIndex: tabState.headers.indexOf(EMAIL_COLUMN_HEADER) };
  };
  googleSheetsService.readTabValues = async (tab) => sharedStore.readTabValues(tab);
  googleSheetsService.updateCell = async (tab, cell, value) => {
    updateCellCalls += 1;
    if (writeBarrier) await writeBarrier;
    const match = String(cell).match(/^([A-Z]+)(\d+)$/i);
    if (!match) return { skipped: true };
    const col = match[1].toUpperCase().charCodeAt(0) - 65;
    const row = Number(match[2]);
    const tabState = sharedStore.tabs.get(tab);
    const index = row - 2;
    const line = [...tabState.rows[index]];
    line[col] = value;
    tabState.rows[index] = line;
    return { skipped: false, updated: true };
  };

  return () => {
    config.googleSheetsEnabled = prevEnabled;
    writeBarrier = null;
    writeBarrierRelease = null;
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

async function createConversation(suffix, email = null) {
  return conversationRepository.createConversation({
    channel: 'simulator',
    provider: 'internal',
    externalUserId: `email-sync-${suffix}`,
    phoneNumber: `+54911sync${suffix}`,
    displayName: `Sync ${suffix}`,
    status: 'bot',
    currentFlowId: 'main-menu',
    currentNodeKey: 'welcome',
    contactEmail: email,
  });
}

async function seedExportRow(conversationId, rowNumber) {
  await conversationSheetExportRepository.upsertExport({
    conversationId,
    sheetTabName: config.googleSheetsTabName,
    sheetRowNumber: rowNumber,
    exportStatus: 'confirmed',
    finalStatus: 'completed',
    idempotencyKey: `conversation:${conversationId}:primary`,
    exportedAt: new Date(),
    lastSyncAt: new Date(),
  });
}

test('CR4-001 — generación nueva gana sobre escritura externa bloqueada', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);

  sharedStore.tabs.clear();
  const headers = [CONVERSATION_ID_COLUMN_HEADER, EMAIL_COLUMN_HEADER];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);

  const conversation = await createConversation(`${Date.now()}`, 'alpha@example.com');
  const rowNumber = 2;
  sharedStore.ensureTab(config.googleSheetsTabName, headers).rows.push([conversation.id, 'pending@example.com']);
  await seedExportRow(conversation.id, rowNumber);
  const jobAlpha = await enqueueEmailSheetSync(conversation.id, 'alpha@example.com');
  const genAlpha = jobAlpha.jobGeneration;

  writeBarrier = new Promise((resolve) => { writeBarrierRelease = resolve; });
  const workerA = runDueSheetSyncJobs({ workerId: buildSheetWorkerId('worker-a'), limit: 1 });
  await new Promise((r) => setTimeout(r, 50));

  await conversationRepository.syncContactEmailForConversationId(
    conversation.id,
    'beta@example.com',
    new Date('2026-02-01T12:00:00Z'),
  );
  await enqueueEmailSheetSync(conversation.id, 'beta@example.com');
  const jobAfter = await conversationSheetSyncJobRepository.findByConversation(conversation.id);
  assert.ok(jobAfter.jobGeneration > genAlpha);

  writeBarrierRelease();
  await workerA;
  let workerB = { completed: 0 };
  for (let i = 0; i < 5; i += 1) {
    workerB = await runDueSheetSyncJobs({ workerId: buildSheetWorkerId(`worker-b-${i}`), limit: 3 });
    const mid = await conversationSheetSyncJobRepository.findByConversation(conversation.id);
    if (mid?.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(workerB.completed >= 1 || (await conversationSheetSyncJobRepository.findByConversation(conversation.id))?.status === 'completed');

  const staleAttempt = await conversationSheetSyncJobRepository.markCompleted(jobAfter.id, {
    ownerId: jobAlpha.workerOwner || 'stale-owner',
    jobGeneration: genAlpha,
    payloadHash: emailPayloadHash('alpha@example.com'),
  });
  assert.equal(staleAttempt, null);

  const row = await conversationRepository.findById(conversation.id);
  assert.equal(row.contactEmail, 'beta@example.com');
  const physical = sharedStore.getRow(config.googleSheetsTabName, rowNumber);
  assert.equal(String(physical?.[1]).toLowerCase(), 'beta@example.com');

  const finalJob = await conversationSheetSyncJobRepository.findByConversation(conversation.id);
  assert.equal(finalJob.status, 'completed');

  t.after(async () => {
    await conversationSheetSyncJobRepository.cancelForConversation(conversation.id);
  });
});

test('CR4-002 — dos workers sin solapamiento y una escritura por fila', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);
  sharedStore.tabs.clear();
  const headers = [CONVERSATION_ID_COLUMN_HEADER, EMAIL_COLUMN_HEADER];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);

  const a = await createConversation(`cA-${Date.now()}`, 'a@example.com');
  const b = await createConversation(`cB-${Date.now()}`, 'b@example.com');
  sharedStore.ensureTab(config.googleSheetsTabName, headers).rows.push([a.id, 'a@example.com']);
  sharedStore.ensureTab(config.googleSheetsTabName, headers).rows.push([b.id, 'b@example.com']);
  await seedExportRow(a.id, 2);
  await seedExportRow(b.id, 3);

  await conversationRepository.syncContactEmailForConversationId(a.id, 'a2@example.com', new Date());
  await conversationRepository.syncContactEmailForConversationId(b.id, 'b2@example.com', new Date());
  await enqueueEmailSheetSync(a.id, 'a2@example.com');
  await enqueueEmailSheetSync(b.id, 'b2@example.com');

  const [runA, runB] = await Promise.all([
    runDueSheetSyncJobs({ workerId: buildSheetWorkerId('worker-1'), limit: 5 }),
    runDueSheetSyncJobs({ workerId: buildSheetWorkerId('worker-2'), limit: 5 }),
  ]);

  const owners = [...(runA.acquiredOwners || []), ...(runB.acquiredOwners || [])]
    .filter(Boolean);
  assert.ok(owners.length >= 2);
  assert.equal(new Set(owners).size, owners.length);

  const jobA = await conversationSheetSyncJobRepository.findByConversation(a.id);
  const jobB = await conversationSheetSyncJobRepository.findByConversation(b.id);
  assert.equal(jobA.status, 'completed');
  assert.equal(jobB.status, 'completed');
  assert.equal(updateCellCalls, 2);
  assert.equal(String(sharedStore.getRow(config.googleSheetsTabName, 2)?.[1]).toLowerCase(), 'a2@example.com');
  assert.equal(String(sharedStore.getRow(config.googleSheetsTabName, 3)?.[1]).toLowerCase(), 'b2@example.com');

  t.after(async () => {
    await conversationSheetSyncJobRepository.cancelForConversation(a.id);
    await conversationSheetSyncJobRepository.cancelForConversation(b.id);
  });
});

test('CR4-002 — exhausted se reactiva y completa', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);
  sharedStore.tabs.clear();

  const conversation = await createConversation(`ex-${Date.now()}`, 'old@example.com');
  const headers = [CONVERSATION_ID_COLUMN_HEADER, EMAIL_COLUMN_HEADER];
  sharedStore.ensureTab(config.googleSheetsTabName, headers).rows.push([conversation.id, 'old@example.com']);
  await seedExportRow(conversation.id, 2);
  await enqueueEmailSheetSync(conversation.id, 'old@example.com');
  const job = await conversationSheetSyncJobRepository.findByConversation(conversation.id);
  for (let i = 0; i < 8; i += 1) {
    await conversationSheetSyncJobRepository.markRetry(job.id, 'forced', 1);
  }
  assert.equal((await conversationSheetSyncJobRepository.findByConversation(conversation.id)).status, 'exhausted');

  await conversationRepository.syncContactEmailForConversationId(
    conversation.id,
    'new@example.com',
    new Date(),
  );
  await enqueueEmailSheetSync(conversation.id, 'new@example.com');
  const run = await runDueSheetSyncJobs({ workerId: buildSheetWorkerId('ex-retry'), limit: 1 });
  assert.equal(run.completed, 1);
  const final = await conversationSheetSyncJobRepository.findByConversation(conversation.id);
  assert.equal(final.status, 'completed');
  assert.equal(String(sharedStore.getRow(config.googleSheetsTabName, 2)?.[1]).toLowerCase(), 'new@example.com');

  t.after(async () => {
    await conversationSheetSyncJobRepository.cancelForConversation(conversation.id);
  });
});

test('CR5-001 — mismo email usa coordinación y no sobrescribe valor más reciente', async (t) => {
  const skip = await skipIfNoDb();
  if (skip) {
    t.skip(skip);
    return;
  }
  const restore = installMockSheets();
  t.after(restore);

  sharedStore.tabs.clear();
  const headers = [CONVERSATION_ID_COLUMN_HEADER, EMAIL_COLUMN_HEADER];
  sharedStore.ensureTab(config.googleSheetsTabName, headers);

  const conversation = await createConversation(`${Date.now()}`, 'alpha@example.com');
  const rowNumber = 2;
  sharedStore.ensureTab(config.googleSheetsTabName, headers).rows.push([conversation.id, 'stale@example.com']);
  await seedExportRow(conversation.id, rowNumber);

  writeBarrier = new Promise((resolve) => { writeBarrierRelease = resolve; });
  await enqueueEmailSheetSync(conversation.id, 'alpha@example.com');
  const workerA = runDueSheetSyncJobs({ workerId: buildSheetWorkerId('same-email-a'), limit: 1 });
  await new Promise((r) => setTimeout(r, 40));

  await conversationRepository.syncContactEmailForConversationId(
    conversation.id,
    'beta@example.com',
    new Date('2026-03-01T12:00:00Z'),
  );
  await enqueueEmailSheetSync(conversation.id, 'beta@example.com');

  writeBarrierRelease();
  await workerA;

  await saveContactEmailForConversation(conversation, 'beta@example.com', {
    sourceEventAt: new Date('2026-03-02T12:00:00Z'),
  });

  for (let i = 0; i < 6; i += 1) {
    await runDueSheetSyncJobs({ workerId: buildSheetWorkerId(`same-email-b-${i}`), limit: 3 });
    const mid = await conversationSheetSyncJobRepository.findByConversation(conversation.id);
    if (mid?.status === 'completed') break;
    await new Promise((r) => setTimeout(r, 25));
  }

  const row = await conversationRepository.findById(conversation.id);
  assert.equal(row.contactEmail, 'beta@example.com');
  const physical = sharedStore.getRow(config.googleSheetsTabName, rowNumber);
  assert.equal(String(physical?.[1]).toLowerCase(), 'beta@example.com');

  t.after(async () => {
    await conversationSheetSyncJobRepository.cancelForConversation(conversation.id);
  });
});