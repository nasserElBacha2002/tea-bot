import test from 'node:test';
import assert from 'node:assert/strict';
import conversationExportService from './conversationExport.service.js';
import sessionService from './session.service.js';
import { config } from '../config.js';

test('no exporta cuando no existe sesión', async () => {
  const res = await conversationExportService.exportFinalizedConversation(
    'missing-user',
    'completed'
  );
  assert.equal(res.exported, false);
  assert.equal(res.reason, 'no_session');
});

test('no rompe con sheets deshabilitado y marca exportado', async () => {
  const prev = config.googleSheetsEnabled;
  config.googleSheetsEnabled = false;
  const userId = 'test:user:1';
  await sessionService.createSession(userId, 'main-menu', 'welcome', {
    provider: 'test',
    phone: '+5491111111111',
    answers: { es_estudiante: 'SI' },
    visitedNodes: ['welcome', 'menu'],
  });
  const res = await conversationExportService.exportFinalizedConversation(userId, 'completed', {
    flowId: 'main-menu',
    flowVersion: 'v1',
    reason: 'completed',
    lastNodeId: 'menu',
  });
  assert.equal(res.skipped, true);
  const session = sessionService.getSession(userId);
  assert.ok(session?.exportedAt);
  await sessionService.resetSession(userId);
  config.googleSheetsEnabled = prev;
});

test('permite exportar escalation a humano luego de info inicial', async () => {
  const prevEnabled = config.googleSheetsEnabled;
  const userId = 'test:user:escalation';
  config.googleSheetsEnabled = false;
  await sessionService.createSession(userId, 'main-menu', 'si_pg_direccion', {
    provider: 'test',
    phone: '+5491111111111',
    answers: {},
    visitedNodes: ['welcome', 'si_pg_menu', 'si_pg_direccion'],
    exportedAt: new Date().toISOString(),
    finalStatus: 'info_provided',
  });
  const res = await conversationExportService.exportFinalizedConversation(userId, 'human_handoff', {
    flowId: 'main-menu',
    flowVersion: 'v12',
    reason: 'human_handoff',
    requiresHuman: true,
    lastNodeId: 'human_handoff',
  });
  assert.equal(res.skipped, true);
  const session = sessionService.getSession(userId);
  assert.equal(session?.finalStatus, 'human_handoff');
  assert.ok(session?.exportedEscalationAt);
  await sessionService.resetSession(userId);
  config.googleSheetsEnabled = prevEnabled;
});
