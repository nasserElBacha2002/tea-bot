import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  estimateDayCostFromSqlRow,
  estimateWindowCostsFromSql,
  summarizeEstimatedCosts,
} from './whatsapp-cost-engine.js';
import { getWhatsAppCostAudit } from './whatsapp-cost-audit.service.js';
import { getWhatsAppBillingDashboard } from './whatsapp-billing-dashboard.service.js';
import { resetBillingCache } from './whatsapp-billing-cache.js';
import { resetRateCardCache } from './whatsapp-rate-card.js';
import '../config.js';

const rateCard = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/whatsapp-rate-card-ar.sample.json'),
    'utf8',
  ),
);

function billableForUsedBefore(usedBefore, dayCount) {
  const pack = estimateWindowCostsFromSql(
    [{ dayAr: '2026-10-20', inbound: 0, whatsappOutbound: dayCount, outboundBot: dayCount, outboundAgent: 0 }],
    { startDayAr: '2026-10-20', endDayAr: '2026-10-20' },
    { serviceMessagesBeforeWindow: usedBefore, monthServiceKnown: true },
  );
  return pack.daily[0].costs.metaServiceFreeTier.billableInDay;
}

test('franquicia 999 consumidos deja 1 gratis y 0 facturables en el siguiente', () => {
  assert.equal(billableForUsedBefore(999, 1), 0);
});

test('franquicia 1000 consumidos deja 0 gratis y 1 facturable', () => {
  assert.equal(billableForUsedBefore(1000, 1), 1);
});

test('franquicia 1000 consumidos con 2 mensajes factura 2', () => {
  assert.equal(billableForUsedBefore(1000, 2), 2);
});

test('régimen legacy no cobra Meta service', () => {
  const row = estimateDayCostFromSqlRow(
    { dayAr: '2026-09-15', inbound: 2, whatsappOutbound: 3, outboundBot: 3, outboundAgent: 0 },
    { rateCard, monthServiceKnown: true },
  );
  assert.equal(row.costs.metaEstimatedUsd, 0);
  assert.equal(row.costs.twilioEstimatedUsd, 0.025);
});

test('sin consumo previo conocido la franquicia queda indeterminada', () => {
  const row = estimateDayCostFromSqlRow(
    { dayAr: '2026-10-15', inbound: 0, whatsappOutbound: 5, outboundBot: 5, outboundAgent: 0 },
    { rateCard, monthServiceKnown: false },
  );
  assert.equal(row.costs.metaEstimatedUsd, null);
  assert.equal(row.costs.metaEstimatedQuality, 'non_determinable');
});

test('franquicia acumulada 400+500+300+200 deja 1000 gratis y Meta USD 10.40', () => {
  const daily = [
    { dayAr: '2026-10-01', inbound: 0, whatsappOutbound: 400, outboundBot: 400, outboundAgent: 0 },
    { dayAr: '2026-10-02', inbound: 0, whatsappOutbound: 500, outboundBot: 500, outboundAgent: 0 },
    { dayAr: '2026-10-03', inbound: 0, whatsappOutbound: 300, outboundBot: 300, outboundAgent: 0 },
    { dayAr: '2026-10-04', inbound: 0, whatsappOutbound: 200, outboundBot: 200, outboundAgent: 0 },
  ];
  const window = { startDayAr: '2026-10-01', endDayAr: '2026-10-04' };
  const pack = estimateWindowCostsFromSql(daily, window, {
    serviceMessagesBeforeWindow: 0,
    monthServiceKnown: true,
    fullCalendarMonth: false,
  });
  const summary = summarizeEstimatedCosts(pack.daily);
  assert.equal(summary.outbound, 1400);
  assert.equal(summary.freeServiceMessages, 1000);
  assert.equal(summary.billableServiceMessages, 400);
  assert.equal(summary.metaEstimatedUsd, 10.4);
});

test('reinicio mensual: 1000 en octubre y 600 en noviembre quedan en franquicia', () => {
  const daily = [
    { dayAr: '2026-10-30', inbound: 0, whatsappOutbound: 1000, outboundBot: 1000, outboundAgent: 0 },
    { dayAr: '2026-11-01', inbound: 0, whatsappOutbound: 600, outboundBot: 600, outboundAgent: 0 },
  ];
  const pack = estimateWindowCostsFromSql(daily, { startDayAr: '2026-10-30', endDayAr: '2026-11-01' }, {
    serviceMessagesBeforeWindow: 0,
    monthServiceKnown: true,
  });
  const oct = pack.daily[0].costs.metaServiceFreeTier.billableInDay;
  const nov = pack.daily[1].costs.metaServiceFreeTier.billableInDay;
  assert.equal(oct, 0);
  assert.equal(nov, 0);
});

test('cambio diciembre/enero reinicia franquicia', () => {
  const daily = [
    { dayAr: '2026-12-31', inbound: 0, whatsappOutbound: 1000, outboundBot: 1000, outboundAgent: 0 },
    { dayAr: '2027-01-01', inbound: 0, whatsappOutbound: 1, outboundBot: 1, outboundAgent: 0 },
  ];
  const pack = estimateWindowCostsFromSql(daily, { startDayAr: '2026-12-31', endDayAr: '2027-01-01' }, {
    serviceMessagesBeforeWindow: 0,
    monthServiceKnown: true,
  });
  assert.equal(pack.daily[0].costs.metaServiceFreeTier.billableInDay, 0);
  assert.equal(pack.daily[1].costs.metaServiceFreeTier.billableInDay, 0);
});

test('1400 mensajes elegibles en el mismo mes deja 400 facturables', () => {
  const pack = estimateWindowCostsFromSql(
    [{ dayAr: '2026-10-15', inbound: 0, whatsappOutbound: 1400, outboundBot: 1400, outboundAgent: 0 }],
    { startDayAr: '2026-10-15', endDayAr: '2026-10-15' },
    { serviceMessagesBeforeWindow: 0, monthServiceKnown: true },
  );
  assert.equal(pack.daily[0].costs.metaServiceFreeTier.billableInDay, 400);
});

test('summarizeEstimatedCosts no completa total con Meta desconocido', () => {
  const summary = summarizeEstimatedCosts([
    {
      messages: { inbound: 1, whatsappOutbound: 2, outboundBot: 2, outboundAgent: 0 },
      costs: {
        twilioEstimatedUsd: 0.01,
        twilioEstimatedQuality: 'estimated_sql_proxy',
        metaEstimatedUsd: null,
        metaEstimatedQuality: 'non_determinable',
      },
    },
  ]);
  assert.equal(summary.twilioEstimatedUsd, 0.01);
  assert.equal(summary.metaEstimatedUsd, null);
  assert.equal(summary.totalEstimatedUsd, null);
  assert.equal(summary.totalCompleteness, 'partial');
});

test('audit y dashboard comparten estimaciones SQL equivalentes', async () => {
  resetRateCardCache();
  resetBillingCache();
  const metricsOverride = {
    window: {
      startDayAr: '2026-10-01',
      endDayAr: '2026-10-04',
      startUtc: '2026-10-01T03:00:00.000Z',
      endUtcExclusive: '2026-10-05T03:00:00.000Z',
    },
    daily: [
      { dayAr: '2026-10-01', inbound: 0, whatsappOutbound: 400, outboundBot: 400, outboundAgent: 0, outboundSystem: 0 },
      { dayAr: '2026-10-02', inbound: 0, whatsappOutbound: 500, outboundBot: 500, outboundAgent: 0, outboundSystem: 0 },
      { dayAr: '2026-10-03', inbound: 0, whatsappOutbound: 300, outboundBot: 300, outboundAgent: 0, outboundSystem: 0 },
      { dayAr: '2026-10-04', inbound: 0, whatsappOutbound: 200, outboundBot: 200, outboundAgent: 0, outboundSystem: 0 },
    ],
    deliveryByDay: [],
    definitions: {},
  };
  const [audit, dashboard] = await Promise.all([
    getWhatsAppCostAudit({
      days: 4,
      asOf: new Date('2026-10-05T12:00:00Z'),
      fetchUsage: false,
      metricsOverride,
    }),
    getWhatsAppBillingDashboard({
      days: 4,
      asOf: new Date('2026-10-05T12:00:00Z'),
      fetchUsage: false,
      metricsOverride,
      persistAggregates: false,
    }),
  ]);
  const auditMeta = audit.costs.daily.reduce((sum, row) => sum + (row.costs.metaUsd ?? 0), 0);
  const dashboardMeta = dashboard.indicators.metaCostUsd;
  assert.equal(Math.round(auditMeta * 10000) / 10000, 10.4);
  assert.equal(dashboardMeta, 10.4);
});