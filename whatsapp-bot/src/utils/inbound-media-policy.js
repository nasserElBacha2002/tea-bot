const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

export function normalizeInboundMimeType(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  return value.split(';')[0].trim();
}

export function isAllowedInboundMime(mime, allowedSet) {
  const normalized = normalizeInboundMimeType(mime);
  return normalized.length > 0 && allowedSet.has(normalized);
}

export function extensionForInboundMime(mime) {
  return MIME_EXTENSIONS[normalizeInboundMimeType(mime)] || '';
}

export function parseInboundMediaMaxBytes(raw, fallback = DEFAULT_MAX_BYTES) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 64 * 1024 * 1024);
}

export function parseAllowedInboundMimeCsv(raw) {
  const source = String(raw ?? '').trim();
  const items = source
    ? source.split(',').map((part) => normalizeInboundMimeType(part)).filter(Boolean)
    : Object.keys(MIME_EXTENSIONS);
  return new Set(items);
}

export function sanitizeAttachmentDisplayName(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const base = raw.replace(/[/\\]/g, '_').replace(/\0/g, '');
  if (!base || base === '.' || base === '..') return null;
  return base.slice(0, 200);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIGNATURE = Buffer.from('%PDF-');

export function sniffInboundMediaContent(buffer) {
  if (!buffer || buffer.length === 0) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (buffer.length >= PDF_SIGNATURE.length && buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    return 'application/pdf';
  }
  return null;
}

const PERMANENT_FAILURES = new Set([
  'mime_not_allowed',
  'url_not_allowed',
  'content_invalid',
  'content_empty',
  'twilio_not_configured',
  'size_limit_exceeded',
  'redirect_invalid',
  'redirect_limit',
]);

export function isPermanentInboundMediaFailure(reason) {
  const value = String(reason || '').trim();
  if (PERMANENT_FAILURES.has(value)) return true;
  if (/^download_http_4\d\d$/.test(value) && value !== 'download_http_429') return true;
  return false;
}

export function classifyInboundDownloadFailure(error) {
  const message = String(error?.message || 'download_failed');
  if (message === 'size_limit_exceeded' || message === 'content_empty') return message;
  if (message === 'url_not_allowed' || message === 'redirect_invalid' || message === 'redirect_limit') {
    return message;
  }
  if (message.startsWith('download_http_')) {
    const status = Number(message.replace('download_http_', ''));
    if (status >= 500 || status === 429) return message;
    if (status === 401 || status === 403 || status === 404) return message;
    return message;
  }
  if (error?.name === 'AbortError') return 'download_timeout';
  return 'download_failed';
}

export function computeInboundMediaRetryDelayMs(retryCount, baseMs = 5_000) {
  const capped = Math.min(Math.max(retryCount, 1), 6);
  return baseMs * (2 ** (capped - 1));
}