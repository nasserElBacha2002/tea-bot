import { createHash } from 'node:crypto';

const SEARCH_COLLATION = 'Latin1_General_CI_AI';
const SNIPPET_RADIUS = 60;
const SNIPPET_MAX = 120;

/**
 * Escapa literales para LIKE en SQL Server (escape char `\`).
 * Orden: backslash primero, luego clase de caracteres.
 */
export function escapeLikeLiteral(term) {
  const raw = String(term ?? '');
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export function buildLikePattern(term) {
  return `%${escapeLikeLiteral(term)}%`;
}

export function normalizeSearchTerm(term) {
  return String(term ?? '')
    .normalize('NFKC')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export const CURSOR_VERSION = 2;
export const CURSOR_MAX_BYTES = 384;

export function searchTermFingerprint(term) {
  return createHash('sha256').update(String(term ?? ''), 'utf8').digest('hex').slice(0, 16);
}

export const CURSOR_SCOPES = new Set(['contact', 'message_global', 'message_in_conversation']);

export function validateSearchQuery(q) {
  if (q != null && typeof q !== 'string') {
    return { ok: false, code: 'VALIDATION', message: 'El término de búsqueda debe ser texto.' };
  }
  const trimmed = String(q ?? '').trim();
  if (trimmed.length < 2) {
    return { ok: false, code: 'VALIDATION', message: 'El término de búsqueda debe tener al menos 2 caracteres.' };
  }
  if (trimmed.length > 128) {
    return { ok: false, code: 'VALIDATION', message: 'El término de búsqueda no puede superar 128 caracteres.' };
  }
  return { ok: true, term: trimmed };
}

export function clampSearchLimit(value, { defaultLimit = 25, max = 50 } = {}) {
  const parsed = parseSearchLimit(value, { defaultLimit, max });
  return parsed.ok ? parsed.limit : defaultLimit;
}

export function parseSearchLimit(value, { defaultLimit = 25, max = 50 } = {}) {
  if (value == null || value === '') {
    return { ok: true, limit: defaultLimit };
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { ok: false, message: 'limit debe ser un entero entre 1 y 50.' };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, message: 'limit debe ser un entero entre 1 y 50.' };
  }
  if (n < 1 || n > max) {
    return { ok: false, message: `limit debe estar entre 1 y ${max}.` };
  }
  return { ok: true, limit: n };
}

export const SEARCH_GROUPS = new Set(['both', 'contacts', 'messages']);

export function parseSearchGroups(value) {
  if (value == null || value === '') return { ok: true, groups: 'both' };
  if (typeof value !== 'string') {
    return { ok: false, message: 'groups debe ser both, contacts o messages.' };
  }
  const groups = value.trim().toLowerCase();
  if (!SEARCH_GROUPS.has(groups)) {
    return { ok: false, message: 'groups debe ser both, contacts o messages.' };
  }
  return { ok: true, groups };
}

/**
 * Encuentra la primera coincidencia insensible a acentos/case sobre el texto original.
 * @returns {{ start: number, end: number } | null}
 */
export function findMatchRange(originalText, searchTerm) {
  const haystack = String(originalText ?? '');
  const needle = String(searchTerm ?? '').trim();
  if (!needle) return null;

  const normHay = normalizeForMatch(haystack);
  const normNeedle = normalizeForMatch(needle);
  const idx = normHay.indexOf(normNeedle);
  if (idx < 0) return null;

  const start = mapNormalizedIndexToOriginal(haystack, idx);
  const end = mapNormalizedIndexToOriginal(haystack, idx + normNeedle.length);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

function normalizeForMatch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function mapNormalizedIndexToOriginal(original, normIndex) {
  let normPos = 0;
  let codeUnitIndex = 0;
  for (const char of [...original]) {
    if (normPos >= normIndex) return codeUnitIndex;
    const segment = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    normPos += segment.length;
    codeUnitIndex += char.length;
  }
  return original.length;
}

export function buildSnippet(originalText, searchTerm) {
  const body = String(originalText ?? '');
  const match = findMatchRange(body, searchTerm);
  if (!match) {
    const slice = body.slice(0, SNIPPET_MAX);
    return {
      snippet: slice,
      highlightStart: 0,
      highlightEnd: 0,
    };
  }
  const { start, end } = match;
  const radius = Math.max(SNIPPET_RADIUS, Math.min(String(searchTerm ?? '').trim().length, 128));
  let sliceStart = Math.max(0, start - radius);
  let sliceEnd = Math.min(body.length, sliceStart + SNIPPET_MAX);
  if (sliceEnd - sliceStart < SNIPPET_MAX) {
    sliceStart = Math.max(0, sliceEnd - SNIPPET_MAX);
  }
  const snippet = body.slice(sliceStart, sliceEnd);
  let highlightStart = Math.max(0, start - sliceStart);
  let highlightEnd = Math.max(highlightStart, end - sliceStart);
  if (highlightEnd > snippet.length) {
    highlightEnd = snippet.length;
  }
  if (highlightStart > snippet.length) {
    highlightStart = 0;
    highlightEnd = 0;
  }
  return {
    snippet,
    highlightStart,
    highlightEnd,
  };
}

export function sqlCollateSuffix() {
  return SEARCH_COLLATION;
}

/**
 * @param {{ createdAt?: string | Date | null, id?: string | null }} cursor
 * @param {{ scope: string, q: string, conversationId?: string | null }} context
 */
export function encodeSearchCursor(cursor, context) {
  if (!cursor?.id || !context?.scope || !context?.q) return null;
  if (!CURSOR_SCOPES.has(context.scope)) return null;
  const createdAt = cursor.createdAt == null
    ? null
    : cursor.createdAt instanceof Date
      ? cursor.createdAt.toISOString()
      : String(cursor.createdAt);
  const createdAtAllowedNull = context.scope === 'contact';
  if (createdAt == null && !createdAtAllowedNull) return null;

  const payload = JSON.stringify({
    v: CURSOR_VERSION,
    scope: context.scope,
    qh: searchTermFingerprint(context.q),
    conversationId: context.conversationId ?? null,
    id: String(cursor.id),
    createdAt,
  });
  if (Buffer.byteLength(payload, 'utf8') > CURSOR_MAX_BYTES) return null;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

export function decodeSearchCursor(raw, context) {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.length > CURSOR_MAX_BYTES * 2) return null;
  if (!context?.scope || !context?.q) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed.v) !== CURSOR_VERSION) return null;
    if (parsed.scope !== context.scope) return null;
    const expectedQh = searchTermFingerprint(context.q);
    if (parsed.qh != null && String(parsed.qh) !== expectedQh) return null;
    if (parsed.qh == null && String(parsed.q) !== String(context.q)) return null;
    if (context.conversationId && String(parsed.conversationId || '') !== String(context.conversationId)) {
      return null;
    }
    const id = String(parsed.id || '').trim();
    if (!id || !isUuid(id)) return null;
    if (parsed.createdAt == null || parsed.createdAt === '') {
      if (parsed.scope !== 'contact') return null;
      return { id, createdAt: null };
    }
    const createdAt = String(parsed.createdAt).trim();
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return { id, createdAt };
  } catch {
    return null;
  }
}

/** Compat: cursores v1 sin contexto → rechazados (retorna null). */
export function decodeLegacySearchCursor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed?.v === CURSOR_VERSION) return null;
    const id = String(parsed?.id || '').trim();
    const createdAt = parsed?.createdAt == null ? null : String(parsed.createdAt).trim();
    if (!id || !isUuid(id)) return null;
    if (createdAt != null && createdAt !== '' && Number.isNaN(Date.parse(createdAt))) return null;
    return { id, createdAt: createdAt || null };
  } catch {
    return null;
  }
}

export const VISIBLE_SENDER_TYPES = new Set(['user', 'bot', 'agent', 'system']);

export function isVisibleSearchMessage(row) {
  const sender = String(row?.senderType ?? row?.sender_type ?? '').toLowerCase();
  if (!VISIBLE_SENDER_TYPES.has(sender)) return false;
  const body = String(row?.body ?? '').trim();
  return body.length > 0;
}