import { extensionForInboundMime, normalizeInboundMimeType, sanitizeAttachmentDisplayName } from './inbound-media-policy.js';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function asciiFallbackName(raw) {
  const sanitized = String(raw || '')
    .replace(CONTROL_CHARS, '')
    .replace(/["\\]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .trim();
  if (sanitized && sanitized !== '.' && sanitized !== '..') return sanitized.slice(0, 200);
  return 'attachment.bin';
}

/**
 * @param {'inline' | 'attachment'} dispositionType
 * @param {string} filename
 */
export function buildContentDispositionHeader(dispositionType, filename) {
  const safe = dispositionType === 'inline' ? 'inline' : 'attachment';
  const fromPolicy = sanitizeAttachmentDisplayName(filename);
  const display = fromPolicy || filename || 'attachment.bin';
  const ascii = asciiFallbackName(display);
  const encoded = encodeURIComponent(display);
  return `${safe}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentDownloadFilename(attachment) {
  const safeName = sanitizeAttachmentDisplayName(attachment?.originalName);
  if (safeName) return safeName;
  const mime = normalizeInboundMimeType(attachment?.mimeType);
  const ext = extensionForInboundMime(mime) || '.bin';
  return `adjunto-${attachment?.ordinal ?? 0}${ext}`;
}