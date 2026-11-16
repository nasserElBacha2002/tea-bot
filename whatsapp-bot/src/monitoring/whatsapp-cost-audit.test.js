import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config.js';
import { config } from '../config.js';
import { getWhatsAppCostAudit, resolveReconciliationStatus } from './whatsapp-cost-audit.service.js';
import { parseWhatsAppCostAuditQuery } from './whatsapp-cost-audit-query.js';
import { resetRateCardCache } from './whatsapp-rate-card.js';

const usageFixture = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/twilio-usage-records.sample.json'),
    'utf8',
  ),
);

test('cost audit combina usage confirmado sin doble conteo ni meta inferido desde SQL', async () => {
  resetRateCardCache();
  const prevTwilio = config.monitoringTwilioEnabled;
  const prevSid = config.twilioAccountSid;
  const prevToken = config.twilioAuthToken;
  config.monitoringTwilioEnabled = true;
  config.twilioAccountSid = config.twilioAccountSid || 'AC_test';
  config.twilioAuthToken = config.twilioAuthToken || 'test_token';
  const report = await getWhatsAppCostAudit({
    days: 7,
    asOf: new Date('2026-10-20T15:00:00.000Z'),
    fetchUsage: true,
    usageRequest: async () => ({ status: 200, data: usageFixture }),
    twilioRequest: async ({ url }) => {
      if (String(url).includes('/Balance.json')) {
        return { status: 200, data: { balance: '42.50', currency: 'USD' } };
      }
      return { status: 200, data: { status: 'active', senders: [] } };
    },
    metricsOverride: {
      window: {
        startDayAr: '2026-10-14',
        endDayAr: '2026-10-20',
        startUtc: new Date('2026-10-14T03:00:00.000Z'),
        endUtcExclusive: new Date('2026-10-21T03:00:00.000Z'),
        presentationTimeZone: 'Argentina Standard Time',
        storageTimeZone: 'UTC',
      },
      daily: [
        {
          dayAr: '2026-10-15',
          inbound: 10,
          outbound: 12,
          outboundBot: 8,
          outboundAgent: 4,
          outboundSystem: 1,
          whatsappOutbound: 12,
          uniqueConversations: 3,
        },
      ],
      deliveryByDay: [],
      definitions: {},
    },
  });

  assert.equal(report.templates.available, false);
  assert.equal(report.reconciliation.status, 'partial_billing');
  assert.equal(report.costs.providerUsage.accountTotalUsd, 1.7);
  assert.equal(report.costs.providerUsage.whatsappSubtotalUsd, 1.7);
  assert.equal(report.costs.providerTotals.billingComplete, false);
  assert.equal(report.costs.providerTotals.paginationComplete, true);
  assert.equal(report.costs.providerUsage.excludedNonWhatsappUsd, 3.5);
  assert.equal(report.costs.providerDaily.length, 1);
  assert.equal(report.costs.providerPeriod.length, 1);
  assert.equal(report.costs.providerMonthlyByUsageMonth[0].whatsappSubtotalUsd, 1.7);
  assert.equal(report.costs.daily[0].costs.metaEstimatedUsd, null);
  assert.equal(report.costs.daily[0].costs.metaEstimatedQuality, 'non_determinable');
  assert.equal(report.costs.daily[0].costs.twilioEstimatedUsd, null);
  assert.equal(report.costs.daily[0].costs.twilioEstimatedQuality, 'unavailable');
  assert.equal(report.rateCard.operationalQuality, 'fixture_illustrative_only');
  assert.equal(report.costs.providerUsage.periodAggregateWhatsappUsd, 0.05);
  config.monitoringTwilioEnabled = prevTwilio;
  config.twilioAccountSid = prevSid;
  config.twilioAuthToken = prevToken;
});

test('acumulado mensual agrupa por mes civil AR', async () => {
  const report = await getWhatsAppCostAudit({
    days: 3,
    fetchUsage: false,
    metricsOverride: {
      window: { startDayAr: '2026-09-29', endDayAr: '2026-10-01' },
      daily: [
        { dayAr: '2026-09-29', inbound: 1, outbound: 0, outboundBot: 0, outboundAgent: 0, outboundSystem: 0, whatsappOutbound: 0, uniqueConversations: 1 },
        { dayAr: '2026-10-01', inbound: 2, outbound: 3, outboundBot: 2, outboundAgent: 1, outboundSystem: 0, whatsappOutbound: 3, uniqueConversations: 1 },
      ],
      deliveryByDay: [],
      definitions: {},
    },
  });
  assert.equal(report.costs.monthlyByCalendar.length, 2);
  assert.equal(report.costs.monthlyByCalendar[0].monthAr, '2026-09');
  assert.equal(report.costs.monthlyByCalendar[1].monthAr, '2026-10');
  assert.equal(report.costs.daily[0].costs.regime, 'meta-legacy');
  assert.equal(report.costs.daily[1].costs.regime, 'meta-2026-10');
  assert.equal(report.costs.monthlyByCalendar[0].monthCoverage, 'partial_month');
  assert.equal(report.costs.monthlyByCalendar[1].monthCoverage, 'partial_month');
});

test('partial_truncated se propaga a conciliación y dataQuality', async () => {
  const prevTwilio = config.monitoringTwilioEnabled;
  config.monitoringTwilioEnabled = true;
  config.twilioAccountSid = config.twilioAccountSid || 'AC_test';
  config.twilioAuthToken = config.twilioAuthToken || 'test_token';
  const report = await getWhatsAppCostAudit({
    days: 5,
    fetchUsage: true,
    metricsOverride: {
      window: {
        startDayAr: '2026-10-08',
        endDayAr: '2026-10-10',
        startUtc: new Date('2026-10-08T03:00:00.000Z'),
        endUtcExclusive: new Date('2026-10-11T03:00:00.000Z'),
      },
      daily: [],
      deliveryByDay: [],
      definitions: {},
    },
    usageRequest: async () => ({
      status: 200,
      data: {
        usage_records: [
          {
            category: 'channels-whatsapp-outbound',
            price: '1.00',
            start_date: '2026-10-10',
            end_date: '2026-10-10',
          },
        ],
        next_page_uri: '/2010-04-01/Accounts/AC_test/Usage/Records.json?Page=2',
      },
    }),
  });
  assert.equal(report.dataQuality, 'partial_truncated');
  assert.equal(report.reconciliation.status, 'partial_truncated');
  assert.equal(report.reconciliation.usageQuality, 'partial_truncated');
  assert.equal(report.costs.providerUsage.quality, 'partial_truncated');
  config.monitoringTwilioEnabled = prevTwilio;
});

test('compared solo con billing complete_daily_components y paginación completa', async () => {
  const prevTwilio = config.monitoringTwilioEnabled;
  config.monitoringTwilioEnabled = true;
  config.twilioAccountSid = config.twilioAccountSid || 'AC_test';
  config.twilioAuthToken = config.twilioAuthToken || 'test_token';
  const dailyOnlyFixture = {
    usage_records: [
      {
        category: 'channels-whatsapp-outbound',
        count: '5',
        price: '0.50',
        start_date: '2026-10-10',
        end_date: '2026-10-10',
      },
    ],
  };
  const report = await getWhatsAppCostAudit({
    days: 3,
    fetchUsage: true,
    metricsOverride: {
      window: {
        startDayAr: '2026-10-08',
        endDayAr: '2026-10-10',
        startUtc: new Date('2026-10-08T03:00:00.000Z'),
        endUtcExclusive: new Date('2026-10-11T03:00:00.000Z'),
      },
      daily: [{ dayAr: '2026-10-10', inbound: 0, outbound: 5, outboundBot: 5, outboundAgent: 0, outboundSystem: 0, whatsappOutbound: 5, uniqueConversations: 1 }],
      deliveryByDay: [],
      definitions: {},
    },
    usageRequest: async () => ({ status: 200, data: dailyOnlyFixture }),
  });
  assert.equal(report.reconciliation.status, 'compared');
  assert.equal(report.reconciliation.variance.messageCountDelta, 0);
  assert.equal(report.costs.providerTotals.billingComplete, true);
  config.monitoringTwilioEnabled = prevTwilio;
});

test('resolveReconciliationStatus no marca compared con paginación completa pero billing incompleto', () => {
  const status = resolveReconciliationStatus(
    { ok: true, truncated: false, fetchCompleteness: 'complete_within_page_limit' },
    { billingCompleteness: 'partial_mixed_granularity' },
    10,
  );
  assert.equal(status, 'partial_billing');
});

test('parseWhatsAppCostAuditQuery valida fechas y días', () => {
  const bad = parseWhatsAppCostAuditQuery({ asOf: 'invalid', days: 500 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('asOf_invalid'));
  assert.ok(bad.errors.includes('days_out_of_range'));
  const ok = parseWhatsAppCostAuditQuery({ days: 30, fetchUsage: 'false' });
  assert.equal(ok.ok, true);
  assert.equal(ok.fetchUsage, false);
});