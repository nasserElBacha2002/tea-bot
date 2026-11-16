import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyUsageRecord,
  fetchTwilioUsageRecords,
  hasDailyUsageGranularity,
  resolveBillingCompleteness,
  resolveTwilioNextPageUrl,
  summarizeUsageRecords,
} from './twilio-usage.client.js';

const fixture = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/twilio-usage-records.sample.json'),
    'utf8',
  ),
);

test('classifyUsageRecord separa recargas y excluye SMS de WhatsApp', () => {
  assert.equal(classifyUsageRecord({ category: 'account-top-up' }).billableSpend, false);
  assert.equal(classifyUsageRecord({ category: 'channels-whatsapp-outbound' }).bucket, 'twilio_whatsapp');
  assert.equal(classifyUsageRecord({ category: 'sms' }).bucket, 'excluded_sms_mms');
  assert.equal(classifyUsageRecord({ category: 'sms' }).whatsappScope, false);
});

test('summarizeUsageRecords separa total de cuenta y subtotal WhatsApp sin fallback', () => {
  const summary = summarizeUsageRecords(fixture.usage_records);
  assert.equal(summary.prepaidRechargeUsd, 10);
  assert.equal(summary.excludedNonWhatsappUsd, 3.5);
  assert.equal(summary.whatsappMetaPassthroughUsd, 1.1);
  assert.equal(summary.whatsappTwilioPlatformUsd, 0.6);
  assert.equal(summary.periodAggregateWhatsappUsd, 0.05);
  assert.equal(summary.accountTotalUsd, 1.7);
  assert.equal(summary.whatsappSubtotalUsd, 1.7);
  assert.equal(summary.billingCompleteness, 'partial_mixed_granularity');
  assert.equal(summary.daily[0].usageStartDate, '2026-10-15');
  assert.equal(summary.daily[0].presentationDayAr, null);
  assert.equal(summary.daily[0].whatsappSubtotalUsd, 1.7);
});

test('categorías whatsapp desconocidas no se clasifican como Meta', () => {
  const row = classifyUsageRecord({ category: 'channels-whatsapp-foobar' });
  assert.equal(row.bucket, 'excluded_unknown_whatsapp');
  const summary = summarizeUsageRecords([
    {
      category: 'channels-whatsapp-foobar',
      price: '9.99',
      start_date: '2026-10-15',
      end_date: '2026-10-15',
    },
  ]);
  assert.equal(summary.excludedUnknownWhatsappUsd, 9.99);
  assert.equal(summary.whatsappMetaPassthroughUsd, null);
  assert.equal(summary.billingCompleteness, 'partial_unknown_categories');
});

test('usage agregado mensual no se asigna a días sin granularidad diaria', () => {
  const aggregate = {
    category: 'channels-whatsapp-outbound',
    price: '5.00',
    start_date: '2026-10-01',
    end_date: '2026-10-31',
  };
  assert.equal(hasDailyUsageGranularity(aggregate), false);
  const summary = summarizeUsageRecords([aggregate]);
  assert.equal(summary.daily.length, 0);
  assert.equal(summary.dailyGranularityAvailable, false);
  assert.equal(summary.periodAggregateWhatsappUsd, 5);
  assert.equal(summary.whatsappSubtotalUsd, 5);
  assert.equal(summary.billingCompleteness, 'period_aggregates_only');
  assert.equal(summary.byUsagePeriod.length, 1);
});

test('importe confirmado cero y ajustes negativos se conservan en acumulados', () => {
  const summary = summarizeUsageRecords([
    {
      category: 'channels-whatsapp-inbound',
      price: '0.00',
      start_date: '2026-10-15',
      end_date: '2026-10-15',
    },
    {
      category: 'channels-whatsapp-outbound',
      price: '-0.25',
      start_date: '2026-10-16',
      end_date: '2026-10-16',
    },
  ]);
  assert.equal(summary.daily[0].twilioQuality, 'confirmed_zero');
  assert.equal(summary.whatsappTwilioPlatformUsd, -0.25);
  assert.equal(summary.adjustmentWhatsappUsd, -0.25);
  assert.equal(summary.daily[1].twilioQuality, 'confirmed_adjustment');
});

test('resolveBillingCompleteness distingue paginación de cobertura de facturación', () => {
  assert.equal(
    resolveBillingCompleteness({
      hasDailyComponents: true,
      hasPeriodAggregates: false,
      excludedUnknownWhatsappUsd: 0,
      hasAccountTotal: true,
    }),
    'complete_daily_components',
  );
  assert.equal(
    resolveBillingCompleteness({
      hasDailyComponents: false,
      hasPeriodAggregates: false,
      excludedUnknownWhatsappUsd: 0,
      hasAccountTotal: true,
    }),
    'account_total_only',
  );
});

test('resolveTwilioNextPageUrl rechaza URIs fuera de la cuenta', () => {
  const sid = 'AC_test_account';
  assert.ok(resolveTwilioNextPageUrl(`/2010-04-01/Accounts/${sid}/Usage/Records.json?Page=1`, sid));
  assert.equal(resolveTwilioNextPageUrl('/2010-04-01/Accounts/AC_other/Usage/Records.json', sid), null);
  assert.equal(resolveTwilioNextPageUrl('https://evil.example/hack', sid), null);
});

test('fetchTwilioUsageRecords marca truncamiento de paginación', async () => {
  const sid = 'AC_test';
  let calls = 0;
  const result = await fetchTwilioUsageRecords({
    accountSid: sid,
    authToken: 'token',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    maxPages: 1,
    request: async () => {
      calls += 1;
      return {
        status: 200,
        data: {
          usage_records: fixture.usage_records.slice(0, 2),
          next_page_uri: `/2010-04-01/Accounts/${sid}/Usage/Records.json?Page=1`,
        },
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(result.fetchCompleteness, 'partial_truncated');
  assert.equal(calls, 1);
});

test('fetchTwilioUsageRecords usa request inyectado sin red', async () => {
  const result = await fetchTwilioUsageRecords({
    accountSid: 'AC_test',
    authToken: 'token',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    request: async () => ({ status: 200, data: fixture }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 6);
  assert.equal(result.summary.prepaidRechargeUsd, 10);
});