import '../config.js';
import {
  closeSessionAppLockPool,
  releaseSessionAppLock,
  RETENTION_SWEEP_LOCK_RESOURCE,
  tryAcquireSessionAppLock,
} from '../db/session-app-lock.js';

const mode = process.argv[2] || 'acquire';

const lock = await tryAcquireSessionAppLock(RETENTION_SWEEP_LOCK_RESOURCE, 0);
console.log(JSON.stringify({ acquired: lock.acquired, returnCode: lock.returnCode ?? null }));

if (mode === 'hold' && lock.acquired) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

if (lock.acquired) {
  await releaseSessionAppLock(RETENTION_SWEEP_LOCK_RESOURCE);
}
await closeSessionAppLockPool();