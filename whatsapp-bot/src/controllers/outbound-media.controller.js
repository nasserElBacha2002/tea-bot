import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import {
  absoluteStoragePath,
  resolveInboundMediaRoot,
  verifyInboundMediaObject,
} from '../utils/inbound-media-storage.js';
import { verifyOutboundMediaGrant } from '../utils/outbound-media-grant.js';
import { HTTP_STATUS, sendApiError } from '../utils/http-errors.js';
import {
  extensionForInboundMime,
  normalizeInboundMimeType,
  sanitizeAttachmentDisplayName,
} from '../utils/inbound-media-policy.js';
import { buildContentDispositionHeader } from '../utils/http-content-disposition.js';

function dispositionForOutboundMime(mimeType) {
  const normalized = normalizeInboundMimeType(mimeType);
  if (normalized === 'image/jpeg' || normalized === 'image/png') return 'inline';
  return 'attachment';
}

function filenameForOutboundGrant(grant) {
  const safeName = sanitizeAttachmentDisplayName(grant.originalName);
  if (safeName) return safeName;
  const ext = extensionForInboundMime(grant.mimeType) || '.bin';
  return `adjunto${ext}`;
}

function applyOutboundFileHeaders(res, file) {
  const filename = filenameForOutboundGrant(file.grant);
  const disposition = dispositionForOutboundMime(file.grant.mimeType);
  res.setHeader('Content-Type', file.grant.mimeType);
  res.setHeader('Content-Length', String(file.byteSize));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', buildContentDispositionHeader(disposition, filename));
}

async function openGrantedFile(token) {
  const grant = verifyOutboundMediaGrant(token);
  const rootDir = resolveInboundMediaRoot();
  const readable = await verifyInboundMediaObject(rootDir, grant.storageKey).catch(() => false);
  if (!readable) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const absolutePath = absoluteStoragePath(rootDir, grant.storageKey);
  const stat = await fs.promises.stat(absolutePath);
  return { grant, absolutePath, byteSize: stat.size };
}

function handleGrantError(res, error) {
  if (error?.code === 'NOT_FOUND') {
    return sendApiError(res, {
      error: 'NOT_FOUND',
      message: 'Archivo no encontrado',
      status: HTTP_STATUS.NOT_FOUND,
    });
  }
  const expired = error?.message === 'grant_expired';
  return sendApiError(res, {
    error: expired ? 'GRANT_EXPIRED' : 'FORBIDDEN',
    message: expired ? 'El enlace temporal venció' : 'Enlace no válido',
    status: expired ? HTTP_STATUS.GONE : HTTP_STATUS.FORBIDDEN,
  });
}

export async function headOutboundMediaForTwilio(req, res) {
  if (req.method !== 'HEAD') {
    return sendApiError(res, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método no permitido',
      status: HTTP_STATUS.METHOD_NOT_ALLOWED,
    });
  }
  try {
    const file = await openGrantedFile(req.params.token);
    applyOutboundFileHeaders(res, file);
    res.status(HTTP_STATUS.OK).end();
  } catch (error) {
    return handleGrantError(res, error);
  }
}

export async function streamOutboundMediaForTwilio(req, res) {
  if (req.method !== 'GET') {
    return sendApiError(res, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método no permitido',
      status: HTTP_STATUS.METHOD_NOT_ALLOWED,
    });
  }
  try {
    const file = await openGrantedFile(req.params.token);
    applyOutboundFileHeaders(res, file);
    const stream = createReadStream(file.absolutePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        sendApiError(res, {
          error: 'NOT_FOUND',
          message: 'Archivo no encontrado',
          status: HTTP_STATUS.NOT_FOUND,
        });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  } catch (error) {
    return handleGrantError(res, error);
  }
}