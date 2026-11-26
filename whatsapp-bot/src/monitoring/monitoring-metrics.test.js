import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMonitoringMetricsQuery } from './monitoring-metrics-query.js';

test('parseMonitoringMetricsQuery acepta days válidos', () => {
  const parsed = parseMonitoringMetricsQuery({ days: '7' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.days, 7);
});

test('parseMonitoringMetricsQuery rechaza days fuera de rango', () => {
  const parsed = parseMonitoringMetricsQuery({ days: '120' });
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.includes('days_out_of_range'));
});

test('parseMonitoringMetricsQuery period today fuerza 1 día', () => {
  const parsed = parseMonitoringMetricsQuery({ period: 'today', days: '30' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.days, 1);
});

test('parseMonitoringMetricsQuery rechaza rango invertido', () => {
  const parsed = parseMonitoringMetricsQuery({
    startDay: '2026-03-10',
    endDay: '2026-03-01',
  });
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.includes('day_range_inverted'));
});