const WINDOW_MS = 60_000;
const MAX_PER_USER = 30;
const MAX_CONCURRENT = 8;

/** @type {Map<string, { count: number, windowStart: number }>} */
const buckets = new Map();
let concurrent = 0;

function userKey(req) {
  const user = req.adminUser?.username || req.adminUser?.sub || req.adminUser?.id;
  return String(user || req.ip || 'anonymous');
}

function purgeExpiredBuckets(now = Date.now()) {
  for (const [key, entry] of buckets.entries()) {
    if (now - entry.windowStart >= WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

function resolveWeight(req) {
  const isGlobalSearch = req.method === 'POST' && req.path === '/search';
  if (!isGlobalSearch) return 1;
  const groups = String(req.body?.groups || 'both').toLowerCase();
  if (groups === 'both') return 2;
  return 1;
}

function releaseSlot(req) {
  const slot = req.__conversationSearchSlot;
  if (!slot || slot.released) return;
  slot.released = true;
  concurrent = Math.max(0, concurrent - (slot.weight ?? 1));
}

export function conversationSearchRateLimit(req, res, next) {
  purgeExpiredBuckets();
  const weight = resolveWeight(req);
  if (concurrent + weight > MAX_CONCURRENT) {
    return res.status(503).json({
      ok: false,
      error: 'SEARCH_BUSY',
      message: 'Demasiadas búsquedas en curso. Reintentá en unos segundos.',
    });
  }

  const key = userKey(req);
  const now = Date.now();
  const entry = buckets.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart >= WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  buckets.set(key, entry);

  if (entry.count > MAX_PER_USER) {
    return res.status(429).json({
      ok: false,
      error: 'RATE_LIMITED',
      message: 'Superaste el límite de búsquedas por minuto.',
    });
  }

  concurrent += weight;
  req.__conversationSearchSlot = { weight, released: false };
  next();
}

export function finishConversationSearchRequest(req) {
  releaseSlot(req);
}

export function resetConversationSearchRateLimitForTests() {
  buckets.clear();
  concurrent = 0;
}

export function getConversationSearchConcurrentForTests() {
  return concurrent;
}