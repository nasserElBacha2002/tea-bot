import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';

const RUN_SUFFIX = randomBytes(4).toString('hex');
const HOST = String(os.hostname() || 'host').slice(0, 32);

/**
 * Identidad de worker única entre procesos y contenedores (hostname + pid + sufijo de arranque).
 */
export function buildSheetWorkerId(prefix = 'worker') {
  const container = String(process.env.HOSTNAME || process.env.CONTAINER_ID || '').slice(0, 32);
  const containerPart = container ? `:${container}` : '';
  return `${prefix}:${HOST}${containerPart}:${process.pid}:${RUN_SUFFIX}`;
}

/** Identidad única por adquisición (no reutilizar entre leases). */
export function buildUniqueAcquisitionId(prefix = 'acq') {
  return `${buildSheetWorkerId(prefix)}:${randomUUID()}`.slice(0, 128);
}