import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  META_PRICING_V2_EFFECTIVE,
  applyServiceFreeTier,
  isFullCalendarMonthCoverage,
  metaFeeForServiceMessage,
  metaFeeForUtilityTemplate,
  resolveMetaPricingRegime,
} from './whatsapp-pricing-regime.js';

const rateCard = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/whatsapp-rate-card-ar.sample.json'),
    'utf8',
  ),
);

test('resolveMetaPricingRegime aplica cambio 2026-10-01 por día', () => {
  assert.equal(META_PRICING_V2_EFFECTIVE, '2026-10-01');
  assert.equal(resolveMetaPricingRegime('2026-09-30'), 'meta-legacy');
  assert.equal(resolveMetaPricingRegime('2026-10-01'), 'meta-2026-10');
  assert.equal(resolveMetaPricingRegime('2026-11-01'), 'meta-2026-10');
});

test('ventana que cruza 2026-10-01 usa régimen por cada día', () => {
  assert.notEqual(resolveMetaPricingRegime('2026-09-28'), resolveMetaPricingRegime('2026-10-02'));
});

test('régimen legacy deja service y utility en ventana sin cargo Meta', () => {
  const service = metaFeeForServiceMessage({
    regime: 'meta-legacy',
    rateCard,
    inCustomerWindow: true,
  });
  const utility = metaFeeForUtilityTemplate({
    regime: 'meta-legacy',
    rateCard,
    inCustomerWindow: true,
  });
  assert.equal(service.metaFeeUsd, 0);
  assert.equal(utility.metaFeeUsd, 0);
});

test('franquicia no se aplica en ventana parcial de mes', () => {
  const partial = applyServiceFreeTier({
    regime: 'meta-2026-10',
    serviceMessageCount: 50,
    fullCalendarMonth: false,
    phoneNumberScoped: true,
  });
  assert.equal(partial.quality, 'non_determinable');
  assert.equal(partial.metaBillable, null);
});

test('franquicia mensual por número solo con mes civil completo', () => {
  const window = { startDayAr: '2026-10-01', endDayAr: '2026-10-31' };
  assert.equal(isFullCalendarMonthCoverage(window), true);

  const tier = applyServiceFreeTier({
    regime: 'meta-2026-10',
    serviceMessageCount: 1100,
    freeTierUsedInMonth: 0,
    fullCalendarMonth: true,
    phoneNumberScoped: true,
  });
  assert.equal(tier.quality, 'computed');
  assert.equal(tier.metaBillable, 100);
});

test('rates del fixture no son operacionales confirmados', () => {
  const service = metaFeeForServiceMessage({
    regime: 'meta-2026-10',
    rateCard,
    inCustomerWindow: true,
  });
  assert.equal(service.quality, 'fixture_illustrative');
});