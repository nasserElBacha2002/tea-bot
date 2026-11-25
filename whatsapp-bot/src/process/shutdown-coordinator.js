import { closePool } from '../db/index.js';
import { closeSessionAppLockPool, releaseSessionAppLock, RETENTION_SWEEP_LOCK_RESOURCE } from '../db/session-app-lock.js';

const tasks = [];
let installed = false;
let shuttingDown = false;
let shutdownPromise = null;

export function isShuttingDown() {
  return shuttingDown;
}

/**
 * @param {string} name
 * @param {() => void | Promise<void>} stopFn
 */
export function registerShutdownTask(name, stopFn) {
  tasks.push({ name, stopFn });
}

export async function runGracefulShutdown(signal = 'SIGTERM') {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    shuttingDown = true;
    console.log(`[Shutdown] signal=${signal} tasks=${tasks.length}`);
    for (const task of tasks) {
      try {
        await task.stopFn();
      } catch (error) {
        console.error(`[Shutdown] task_failed name=${task.name} error=${error.message}`);
      }
    }
    try {
      await releaseSessionAppLock(RETENTION_SWEEP_LOCK_RESOURCE);
    } catch {
      /* ignore */
    }
    await closeSessionAppLockPool();
    await closePool();
    console.log('[Shutdown] complete');
  })();
  return shutdownPromise;
}

export function setShuttingDownForTests(value = true) {
  shuttingDown = Boolean(value);
}

export function resetShutdownCoordinatorForTests() {
  shuttingDown = false;
  shutdownPromise = null;
}

export function installProcessShutdownHandlers() {
  if (installed) return;
  installed = true;
  const handler = (signal) => {
    void runGracefulShutdown(signal).finally(() => {
      process.exit(0);
    });
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
}