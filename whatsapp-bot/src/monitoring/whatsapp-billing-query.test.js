import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBillingPeriod } from './whatsapp-billing-query.js';

test('resolveBillingPeriod hoy fuerza 1 día', () => {
  const parsed = resolveBillingPeriod({ period: 'today' }, new Date('2026-10-16T12:00:00Z'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.days, 1);
});

test('resolveBillingPeriod mes anterior establece fin de mes', () => {
  const parsed = resolveBillingPeriod({ period: 'previous_month' }, new Date('2026-11-05T12:00:00Z'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.startDayAr, '2026-10-01');
  assert.equal(parsed.endDayAr, '2026-10-31');
  assert.equal(parsed.days, 31);
});

test('resolveBillingPeriod custom incluye límites UTC', () => {
  const parsed = resolveBillingPeriod({
    period: 'custom',
    startDay: '2026-10-10',
    endDay: '2026-10-12',
  }, new Date('2026-10-15T12:00:00Z'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.window.startDayAr, '2026-10-10');
  assert.equal(parsed.window.endDayAr, '2026-10-12');
});

test('fetchUsage default false para no golpear Twilio en dashboard', () => {
  const parsed = resolveBillingPeriod({ period: '7d' });
  assert.equal(parsed.fetchUsage, false);
});

test('persistAggregates default false en GET dashboard', () => {
  const parsed = resolveBillingPeriod({ period: '7d' });
  assert.equal(parsed.persistAggregates, false);
});