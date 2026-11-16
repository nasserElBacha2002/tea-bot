import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhatsAppCostAuditQuery } from './whatsapp-cost-audit-query.js';

test('rechaza asOf inválido', () => {
  const parsed = parseWhatsAppCostAuditQuery({ asOf: 'not-a-date' });
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.includes('asOf_invalid'));
});

test('rechaza days fuera de rango', () => {
  const parsed = parseWhatsAppCostAuditQuery({ days: 500 });
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.includes('days_out_of_range'));
  assert.equal(parsed.days, 90);
});