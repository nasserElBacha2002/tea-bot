import test from 'node:test';
import assert from 'node:assert/strict';
import conversationAbandonmentService from './conversationAbandonment.service.js';
import conversationExportService from './conversationExport.service.js';
import sessionService from './session.service.js';
import { config } from '../config.js';

test('runSweep exporta y resetea sesiones abandonadas', async () => {
  const originalConfig = {
    enabled: config.abandonTrackingEnabled,
    timeout: config.abandonTimeoutMinutes,
    includeSimulator: config.abandonIncludeSimulator,
  };

  config.abandonTrackingEnabled = true;
  config.abandonTimeoutMinutes = 1;
  config.abandonIncludeSimulator = true;

  const now = new Date();
  const staleIso = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const freshIso = new Date(now.getTime() - 30 * 1000).toISOString();

  const staleUser = 'test:abandon:stale';
  const freshUser = 'test:abandon:fresh';

  await sessionService.createSession(staleUser, 'main-menu', 'node-a', {
    provider: 'simulator',
    phone: 'stale',
    lastMessageAt: staleIso,
    updatedAt: staleIso,
  });
  await sessionService.createSession(freshUser, 'main-menu', 'node-b', {
    provider: 'simulator',
    phone: 'fresh',
    lastMessageAt: freshIso,
    updatedAt: freshIso,
  });

  const originalExport = conversationExportService.exportFinalizedConversation.bind(conversationExportService);
  const calls = [];
  conversationExportService.exportFinalizedConversation = async (userId, status, context) => {
    calls.push({ userId, status, context });
    return { exported: true };
  };

  const result = await conversationAbandonmentService.runSweep();

  assert.equal(result.abandoned, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, staleUser);
  assert.equal(calls[0].status, 'abandoned');
  assert.equal(sessionService.getSession(staleUser), null);
  assert.ok(sessionService.getSession(freshUser));

  conversationExportService.exportFinalizedConversation = originalExport;
  await sessionService.resetSession(freshUser);

  config.abandonTrackingEnabled = originalConfig.enabled;
  config.abandonTimeoutMinutes = originalConfig.timeout;
  config.abandonIncludeSimulator = originalConfig.includeSimulator;
});
