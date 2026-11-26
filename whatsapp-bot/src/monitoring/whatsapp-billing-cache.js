const DEFAULT_TTL_MS = Number(process.env.TWILIO_BILLING_CACHE_MINUTES || 60) * 60 * 1000;
const MAX_RANGE_CACHE_ENTRIES = Number(process.env.TWILIO_BILLING_CACHE_MAX_ENTRIES || 32);

const balanceCache = {
  payload: null,
  fetchedAt: null,
};

const usageByKey = new Map();
const inFlightByKey = new Map();

function fresh(entry, ttlMs = DEFAULT_TTL_MS) {
  if (!entry?.fetchedAt) return false;
  return Date.now() - entry.fetchedAt < ttlMs;
}

export function buildUsageCacheKey({
  accountSid = '',
  startDate = '',
  endDate = '',
  categories = '',
}) {
  return [
    String(accountSid || 'default'),
    String(startDate),
    String(endDate),
    String(categories || 'all'),
  ].join('|');
}

function trimUsageCache() {
  if (usageByKey.size <= MAX_RANGE_CACHE_ENTRIES) return;
  const entries = [...usageByKey.entries()].sort((a, b) => (a[1].fetchedAt ?? 0) - (b[1].fetchedAt ?? 0));
  while (usageByKey.size > MAX_RANGE_CACHE_ENTRIES && entries.length) {
    const [key] = entries.shift();
    usageByKey.delete(key);
  }
}

export function getCachedTwilioUsage(cacheKey) {
  const key = cacheKey || buildUsageCacheKey({});
  const entry = usageByKey.get(key);
  if (fresh(entry)) return entry.payload;
  if (entry?.payload) {
    return { ...entry.payload, stale: true, cacheExpiredAt: entry.fetchedAt };
  }
  return null;
}

export function setCachedTwilioUsage(cacheKey, payload) {
  const key = cacheKey || buildUsageCacheKey({});
  usageByKey.set(key, { fetchedAt: Date.now(), payload });
  trimUsageCache();
}

export function getCachedTwilioBalance() {
  if (fresh(balanceCache)) return balanceCache.payload;
  if (balanceCache.payload) {
    return { ...balanceCache.payload, stale: true, cacheExpiredAt: balanceCache.fetchedAt };
  }
  return null;
}

export function setCachedTwilioBalance(payload) {
  balanceCache.payload = payload;
  balanceCache.fetchedAt = Date.now();
}

export function billingCacheMeta(cacheKey) {
  const usageEntry = cacheKey ? usageByKey.get(cacheKey) : null;
  return {
    usageCachedAt: usageEntry?.fetchedAt ? new Date(usageEntry.fetchedAt).toISOString() : null,
    balanceCachedAt: balanceCache.fetchedAt ? new Date(balanceCache.fetchedAt).toISOString() : null,
    ttlMinutes: DEFAULT_TTL_MS / 60000,
    usageCacheKey: cacheKey || null,
  };
}

export function resetBillingCache() {
  usageByKey.clear();
  inFlightByKey.clear();
  balanceCache.payload = null;
  balanceCache.fetchedAt = null;
}

export async function dedupeBillingFetch(kind, fetcher, cacheKey = null) {
  if (kind === 'balance') {
    if (inFlightByKey.get('balance')) return inFlightByKey.get('balance');
    const promise = Promise.resolve()
      .then(fetcher)
      .finally(() => {
        inFlightByKey.delete('balance');
      });
    inFlightByKey.set('balance', promise);
    return promise;
  }
  const key = cacheKey || buildUsageCacheKey({});
  if (inFlightByKey.get(key)) return inFlightByKey.get(key);
  const promise = Promise.resolve()
    .then(fetcher)
    .finally(() => {
      inFlightByKey.delete(key);
    });
  inFlightByKey.set(key, promise);
  return promise;
}