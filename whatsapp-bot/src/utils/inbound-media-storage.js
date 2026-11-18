import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const DEFAULT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/inbound-media',
);

export function resolveInboundMediaRoot() {
  const configured = String(config.inboundMediaStorageDir || '').trim();
  return configured || DEFAULT_ROOT;
}

export function absoluteStoragePath(rootDir, storageKey) {
  const safeKey = String(storageKey || '').replace(/[/\\]/g, '');
  if (!safeKey) throw new Error('storage_key_invalid');
  const rel = path.join(safeKey.slice(0, 2), safeKey.slice(2));
  return path.join(rootDir, rel);
}

export async function writeInboundMediaObject(rootDir, storageKey, buffer) {
  const absolute = absoluteStoragePath(rootDir, storageKey);
  const part = `${absolute}.part`;
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(part, buffer, { mode: 0o600 });
  await fs.rename(part, absolute);
  const stat = await fs.stat(absolute);
  if (!stat.isFile() || stat.size !== buffer.length) {
    await fs.unlink(absolute).catch(() => {});
    throw new Error('store_fs_verify_failed');
  }
  return absolute;
}

export async function verifyInboundMediaObject(rootDir, storageKey) {
  const absolute = absoluteStoragePath(rootDir, storageKey);
  const stat = await fs.stat(absolute);
  return stat.isFile() && stat.size > 0;
}

export async function deleteInboundMediaObject(rootDir, storageKey) {
  if (!storageKey) return false;
  try {
    await fs.unlink(absoluteStoragePath(rootDir, storageKey));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}