import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampMetricsDays,
  isSyntheticTwilioOutboundProviderMessageId,
  mapDailyMessageRow,
  mapDeliveryStatusRow,
  mapMetricsWindowRow,
  TEMPLATE_METRIC_LIMITATION,
} from './whatsapp-daily-metrics.js';

test('clampMetricsDays acota 1..90 y usa 30 por defecto', () => {
  assert.equal(clampMetricsDays(undefined), 30);
  assert.equal(clampMetricsDays(0), 1);
  assert.equal(clampMetricsDays(30), 30);
  assert.equal(clampMetricsDays(120), 90);
  assert.equal(clampMetricsDays('7'), 7);
  assert.equal(clampMetricsDays(NaN), 30);
});

test('isSyntheticTwilioOutboundProviderMessageId distingue TwiML de REST', () => {
  assert.equal(isSyntheticTwilioOutboundProviderMessageId('SM123:outbound'), true);
  assert.equal(isSyntheticTwilioOutboundProviderMessageId('out_deadbeef'), true);
  assert.equal(isSyntheticTwilioOutboundProviderMessageId('SM987654321'), false);
  assert.equal(isSyntheticTwilioOutboundProviderMessageId(null), false);
  assert.equal(isSyntheticTwilioOutboundProviderMessageId(''), false);
});

test('mapDailyMessageRow calcula whatsappOutbound sin system', () => {
  const row = mapDailyMessageRow({
    day_ar: '2026-11-16',
    inbound: 2,
    outbound: 5,
    outbound_bot: 2,
    outbound_agent: 1,
    outbound_system: 2,
    unique_conversations: 1,
  });
  assert.equal(row.inbound, 2);
  assert.equal(row.outbound, 5);
  assert.equal(row.whatsappOutbound, 3);
  assert.equal(row.outboundSystem, 2);
  assert.equal(row.uniqueConversations, 1);
});

test('mapDeliveryStatusRow normaliza status', () => {
  const row = mapDeliveryStatusRow({ day_ar: '2026-11-16', status: 'Delivered', sid_count: 4 });
  assert.equal(row.status, 'delivered');
  assert.equal(row.sidCount, 4);
});

test('mapMetricsWindowRow expone ventana AR y UTC', () => {
  const mapped = mapMetricsWindowRow({
    start_day_ar: '2026-10-18',
    end_day_ar: '2026-11-16',
    start_utc: new Date('2026-10-18T03:00:00.000Z'),
    end_utc_exclusive: new Date('2026-11-17T03:00:00.000Z'),
  });
  assert.equal(mapped.startDayAr, '2026-10-18');
  assert.equal(mapped.presentationTimeZone, 'Argentina Standard Time');
  assert.equal(mapped.storageTimeZone, 'UTC');
});

test('templates queda como limitación explícita', () => {
  assert.equal(TEMPLATE_METRIC_LIMITATION.available, false);
  assert.match(TEMPLATE_METRIC_LIMITATION.reason, /TEMPLATE/);
});