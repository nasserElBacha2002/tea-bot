import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config.js';
import { isConversationDbEnabled, pingDatabase } from '../db/index.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import {
  closeSessionAppLockPool,
  releaseSessionAppLock,
  RETENTION_SWEEP_LOCK_RESOURCE,
  tryAcquireSessionAppLock,
} from '../db/session-app-lock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'conversationRetention.distributed.worker.js');

async function skipIfNoDb() {
  const isolated = isolatedTestDatabaseReason();
  if (isolated) return isolated;
  if (!isConversationDbEnabled()) return 'Conversation DB disabled';
  const ping = await pingDatabase();
  if (!ping.ok) return 'Conversation DB unavailable';
  return null;
}

function runWorker(mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, mode], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout }));
  });
}

test('sp_getapplock impide segunda adquisición concurrente', async (t) => {
  const reason = await skipIfNoDb();
  if (reason) {
    t.skip(reason);
    return;
  }

  try {
    const first = await tryAcquireSessionAppLock(RETENTION_SWEEP_LOCK_RESOURCE, 0);
    assert.equal(first.acquired, true);

    const block = await runWorker('acquire');
    assert.equal(block.code, 0);
    const blockedPayload = JSON.parse(block.stdout.trim().split('\n').pop());
    assert.equal(blockedPayload.acquired, false);
    assert.ok(Number.isFinite(blockedPayload.returnCode));

    await releaseSessionAppLock(RETENTION_SWEEP_LOCK_RESOURCE);

    const after = await runWorker('acquire');
    assert.equal(after.code, 0);
    const afterPayload = JSON.parse(after.stdout.trim().split('\n').pop());
    assert.equal(afterPayload.acquired, true);
  } finally {
    await releaseSessionAppLock(RETENTION_SWEEP_LOCK_RESOURCE);
    await closeSessionAppLockPool();
  }
});