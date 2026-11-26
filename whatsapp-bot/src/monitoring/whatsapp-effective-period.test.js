import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffectiveBillingPeriod } from './whatsapp-effective-period.js';

test('hoy usa día Argentina y no UTC crudo', () => {
  const resolved = resolveEffectiveBillingPeriod({ period: 'today' }, new Date('2026-10-16T05:30:00Z'));
  assert.equal(resolved.ok, true);
  assert.equal(resolved.startDayAr, resolved.endDayAr);
  assert.equal(resolved.startDayAr, '2026-10-16');
  assert.equal(resolved.days, 1);
});

test('mes anterior usa mes civil completo, no 90 días', () => {
  const resolved = resolveEffectiveBillingPeriod({ period: 'previous_month' }, new Date('2026-11-05T15:00:00Z'));
  assert.equal(resolved.ok, true);
  assert.equal(resolved.startDayAr, '2026-10-01');
  assert.equal(resolved.endDayAr, '2026-10-31');
  assert.equal(resolved.days, 31);
});

test('rechaza rango futuro', () => {
  const resolved = resolveEffectiveBillingPeriod(
    { period: 'today' },
    new Date('2099-01-01T12:00:00Z'),
  );
  assert.equal(resolved.ok, false);
  assert.ok(resolved.errors.includes('asOf_future'));
});