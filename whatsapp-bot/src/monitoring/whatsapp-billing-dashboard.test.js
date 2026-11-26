import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { config } from '../config.js';
import { resetBillingCache } from './whatsapp-billing-cache.js';
import { billingDailyToCsv, getWhatsAppBillingDashboard } from './whatsapp-billing-dashboard.service.js';
import { resetRateCardCache } from './whatsapp-rate-card.js';

test('billing dashboard no consulta Twilio cuando fetchUsage=false', async () => {
  resetRateCardCache();
  resetBillingCache();
  const prev = config.monitoringTwilioEnabled;
  config.monitoringTwilioEnabled = true;
  const dashboard = await getWhatsAppBillingDashboard({
    days: 7,
    asOf: new Date('2026-10-20T12:00:00Z'),
    fetchUsage: false,
    metricsOverride: {
      window: {
        startDayAr: '2026-10-14',
        endDayAr: '2026-10-20',
        startUtc: '2026-10-14T03:00:00.000Z',
        endUtcExclusive: '2026-10-21T03:00:00.000Z',
      },
      daily: [
        {
          dayAr: '2026-10-15',
          inbound: 4,
          outbound: 6,
          outboundBot: 5,
          outboundAgent: 1,
          outboundSystem: 0,
          whatsappOutbound: 6,
        },
      ],
    },
  });
  config.monitoringTwilioEnabled = prev;
  assert.equal(dashboard.provider.quality, 'not_fetched');
  assert.equal(dashboard.indicators.messagesReceived, 4);
  assert.ok(dashboard.indicators.twilioCostUsd != null);
  assert.match(dashboard.dataQuality.estimatedCosts, /estimated/);
});

test('billingDailyToCsv incluye encabezados sin PII', () => {
  const csv = billingDailyToCsv([
    {
      dayAr: '2026-10-15',
      inbound: 1,
      outbound: 2,
      outboundBot: 1,
      outboundAgent: 1,
      freeService: 1,
      billableService: 1,
      twilioEstimatedUsd: 0.01,
      metaEstimatedUsd: 0.02,
      totalEstimatedUsd: 0.03,
      twilioConfirmedUsd: null,
      metaConfirmedUsd: null,
      totalConfirmedUsd: null,
    },
  ]);
  assert.match(csv, /day_ar,inbound,outbound/);
  assert.doesNotMatch(csv, /\+549/);
});