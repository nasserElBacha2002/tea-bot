import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUsageCacheKey,
  dedupeBillingFetch,
  getCachedTwilioUsage,
  resetBillingCache,
  setCachedTwilioUsage,
} from './whatsapp-billing-cache.js';

test('cache usage diferencia rangos', () => {
  resetBillingCache();
  const keyA = buildUsageCacheKey({ accountSid: 'AC1', startDate: '2026-10-01', endDate: '2026-10-07' });
  const keyB = buildUsageCacheKey({ accountSid: 'AC1', startDate: '2026-10-08', endDate: '2026-10-14' });
  setCachedTwilioUsage(keyA, { ok: true, summary: { accountTotalUsd: 1 } });
  setCachedTwilioUsage(keyB, { ok: true, summary: { accountTotalUsd: 2 } });
  assert.equal(getCachedTwilioUsage(keyA).summary.accountTotalUsd, 1);
  assert.equal(getCachedTwilioUsage(keyB).summary.accountTotalUsd, 2);
});

test('dedupeBillingFetch coalesce solicitudes concurrentes por clave', async () => {
  resetBillingCache();
  const key = buildUsageCacheKey({ startDate: '2026-10-01', endDate: '2026-10-02' });
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, summary: { accountTotalUsd: 3 } };
  };
  const [a, b] = await Promise.all([
    dedupeBillingFetch('usage', fetcher, key),
    dedupeBillingFetch('usage', fetcher, key),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.summary.accountTotalUsd, 3);
  assert.equal(b.summary.accountTotalUsd, 3);
});