import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import {
  extensionForInboundMime,
  isAllowedInboundMime,
  normalizeInboundMimeType,
  sanitizeAttachmentDisplayName,
  sniffInboundMediaContent,
} from '../utils/inbound-media-policy.js';
import {
  deleteInboundMediaObject,
  resolveInboundMediaRoot,
  writeInboundMediaObject,
} from '../utils/inbound-media-storage.js';
import {
  buildTwilioFetchableOutboundMediaUrl,
  createOutboundMediaGrant,
} from '../utils/outbound-media-grant.js';

function appError(code, message, httpStatus = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.apiError = code;
  err.apiMessage = message;
  if (details) err.details = details;
  return err;
}

function validateOutboundBuffer(buffer, declaredMime) {
  if (!buffer?.length) {
    throw appError('ATTACHMENT_INVALID', 'El archivo adjunto está vacío', 400);
  }
  if (buffer.length > config.inboundMediaMaxBytes) {
    throw appError('ATTACHMENT_TOO_LARGE', 'El archivo supera el tamaño máximo permitido', 413);
  }
  const sniffed = sniffInboundMediaContent(buffer);
  if (!sniffed || sniffed !== declaredMime) {
    throw appError('ATTACHMENT_INVALID', 'El contenido del archivo no coincide con su tipo', 400);
  }
  return {
    buffer,
    mimeType: declaredMime,
    byteSize: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

/**
 * @param {{ fileName?: string, mimeType?: string, contentBase64?: string, buffer?: Buffer } | null | undefined} raw
 */
export function parseAgentOutboundAttachment(raw) {
  if (!raw) return null;
  const declaredMime = normalizeInboundMimeType(raw.mimeType);
  if (!declaredMime || !isAllowedInboundMime(declaredMime, config.inboundMediaAllowedMimeTypes)) {
    throw appError('MIME_NOT_ALLOWED', 'Tipo de archivo no permitido', 400);
  }
  let buffer = raw.buffer;
  if (!buffer) {
    if (!raw.contentBase64) return null;
    try {
      buffer = Buffer.from(String(raw.contentBase64), 'base64');
    } catch {
      throw appError('ATTACHMENT_INVALID', 'El archivo adjunto no es válido', 400);
    }
  }
  const validated = validateOutboundBuffer(buffer, declaredMime);
  const originalName = sanitizeAttachmentDisplayName(raw.fileName);
  return {
    ...validated,
    originalName,
  };
}

/**
 * @param {{ buffer: Buffer, mimeType: string }} prepared
 */
export async function storePreparedOutboundAttachment(prepared) {
  const root = resolveInboundMediaRoot();
  const storageKey = `${randomUUID().replace(/-/g, '')}${extensionForInboundMime(prepared.mimeType)}`;
  try {
    await writeInboundMediaObject(root, storageKey, prepared.buffer);
  } catch {
    throw appError('ATTACHMENT_STORAGE_FAILED', 'No se pudo guardar el archivo', 500);
  }
  return { root, storageKey };
}

export async function discardStoredOutboundAttachment(root, storageKey) {
  if (!storageKey) return;
  await deleteInboundMediaObject(root, storageKey).catch(() => {});
}

/**
 * @param {string} storageKey
 * @param {string} mimeType
 * @param {string | null | undefined} [originalName]
 */
export function buildTwilioMediaUrlForStoredObject(storageKey, mimeType, originalName = null) {
  const { token } = createOutboundMediaGrant({ storageKey, mimeType, originalName });
  return buildTwilioFetchableOutboundMediaUrl(token, { originalName, mimeType });
}