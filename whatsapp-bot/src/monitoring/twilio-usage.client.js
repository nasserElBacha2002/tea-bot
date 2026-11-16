import axios from 'axios';

const RECHARGE_CATEGORY = /top-?up|recharge|payments?/i;
const META_PASS_THROUGH_CATEGORY = /channels-whatsapp-(?:conversation|template)/i;
const TWILIO_WHATSAPP_CATEGORY = /^channels-whatsapp-(?:outbound|inbound)$/i;
const SMS_MMS_CATEGORY = /^(?:sms|mms)(?:-|$|\.)/i;

function round4(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function safeError(error) {
  const status = error?.response?.status || null;
  const message = error?.response?.data?.message || error?.message || 'twilio_request_failed';
  return { status, message: String(message).slice(0, 200) };
}

function priceQuality(price) {
  if (price == null || !Number.isFinite(price)) return 'unavailable';
  if (price === 0) return 'confirmed_zero';
  if (price < 0) return 'confirmed_adjustment';
  return 'confirmed_provider';
}

async function defaultRequest({ url, accountSid, authToken, timeoutMs }) {
  const response = await axios.get(url, {
    auth: { username: accountSid, password: authToken },
    timeout: timeoutMs,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

function normalizeRecord(row) {
  const category = String(row.category || '').trim();
  const price = Number(row.price);
  const count = Number(row.count);
  return {
    category,
    description: row.description || null,
    count: Number.isFinite(count) ? count : null,
    countUnit: row.count_unit || null,
    usage: row.usage || null,
    usageUnit: row.usage_unit || null,
    price: Number.isFinite(price) ? price : null,
    priceUnit: row.price_unit || 'USD',
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    uri: row.uri || null,
  };
}

export function isAggregatedUsagePeriod(record) {
  if (!record?.startDate || !record?.endDate) return false;
  return record.startDate !== record.endDate;
}

export function hasDailyUsageGranularity(record) {
  if (!record.startDate) return false;
  if (!record.endDate) return true;
  return record.startDate === record.endDate;
}

export function classifyUsageRecord(record) {
  const category = String(record.category || '').toLowerCase();
  if (category === 'totalprice' || category === 'total') {
    return { bucket: 'control_total', billableSpend: false, whatsappScope: false, rollupRole: 'control' };
  }
  if (RECHARGE_CATEGORY.test(category)) {
    return { bucket: 'prepaid_recharge', billableSpend: false, whatsappScope: false, rollupRole: 'excluded' };
  }
  if (SMS_MMS_CATEGORY.test(category) || category === 'sms' || category === 'mms') {
    return { bucket: 'excluded_sms_mms', billableSpend: false, whatsappScope: false, rollupRole: 'excluded' };
  }
  if (META_PASS_THROUGH_CATEGORY.test(category)) {
    return { bucket: 'meta_whatsapp', billableSpend: true, whatsappScope: true, rollupRole: 'component' };
  }
  if (TWILIO_WHATSAPP_CATEGORY.test(category)) {
    return { bucket: 'twilio_whatsapp', billableSpend: true, whatsappScope: true, rollupRole: 'component' };
  }
  if (/^channels-whatsapp/.test(category)) {
    return {
      bucket: 'excluded_unknown_whatsapp',
      billableSpend: false,
      whatsappScope: false,
      rollupRole: 'excluded',
    };
  }
  return { bucket: 'excluded_other', billableSpend: false, whatsappScope: false, rollupRole: 'excluded' };
}

export function resolveBillingCompleteness({
  hasDailyComponents,
  hasPeriodAggregates,
  excludedUnknownWhatsappUsd,
  hasAccountTotal,
}) {
  if (excludedUnknownWhatsappUsd !== 0) return 'partial_unknown_categories';
  if (hasDailyComponents && hasPeriodAggregates) return 'partial_mixed_granularity';
  if (hasDailyComponents) return 'complete_daily_components';
  if (hasPeriodAggregates) return 'period_aggregates_only';
  if (hasAccountTotal) return 'account_total_only';
  return 'inconclusive';
}

export function resolveTwilioNextPageUrl(nextUri, accountSid) {
  if (!nextUri || !accountSid) return null;
  const text = String(nextUri);
  if (!text.startsWith('/2010-04-01/')) return null;
  const expectedPrefix = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/`;
  if (!text.startsWith(expectedPrefix)) return null;
  if (text.includes('//') || text.includes('..')) return null;
  return `https://api.twilio.com${text}`;
}

export function summarizeUsageRecords(records) {
  const summary = {
    accountTotalUsd: null,
    whatsappTwilioPlatformUsd: null,
    whatsappMetaPassthroughUsd: null,
    whatsappSubtotalUsd: null,
    componentTwilioUsd: 0,
    componentMetaUsd: 0,
    periodAggregateWhatsappUsd: 0,
    adjustmentWhatsappUsd: 0,
    prepaidRechargeUsd: 0,
    excludedNonWhatsappUsd: 0,
    excludedUnknownWhatsappUsd: 0,
    categories: [],
    byUsageDay: new Map(),
    byUsagePeriod: [],
    dailyGranularityAvailable: false,
    billingCompleteness: 'inconclusive',
    rollupPolicy:
      'accountTotalUsd (totalprice) ≠ whatsappSubtotalUsd. No usar uno como fallback del otro.',
    usageDateTimezoneNote:
      'start_date de Twilio es fecha de usage del proveedor; no es día civil Argentina.',
  };

  let hasDailyTwilio = false;
  let hasDailyMeta = false;
  let hasPeriodAggregate = false;
  let hasAccountTotal = false;

  for (const raw of records) {
    const record = normalizeRecord(raw);
    const classified = classifyUsageRecord(record);
    const { bucket, billableSpend, whatsappScope, rollupRole } = classified;
    const price = record.price ?? 0;
    const dailyGranular = hasDailyUsageGranularity(record);
    const aggregated = isAggregatedUsagePeriod(record);
    summary.categories.push({
      ...record,
      bucket,
      billableSpend,
      whatsappScope,
      rollupRole,
      dailyGranular,
      aggregated,
      priceQuality: priceQuality(price),
    });

    if (bucket === 'prepaid_recharge') {
      summary.prepaidRechargeUsd += price;
      continue;
    }
    if (bucket === 'control_total') {
      summary.accountTotalUsd = price;
      hasAccountTotal = true;
      continue;
    }
    if (bucket === 'excluded_unknown_whatsapp') {
      summary.excludedUnknownWhatsappUsd += price;
      continue;
    }
    if (!whatsappScope) {
      summary.excludedNonWhatsappUsd += price;
      continue;
    }
    if (!billableSpend) continue;

    if (aggregated) {
      summary.periodAggregateWhatsappUsd += price;
      hasPeriodAggregate = true;
      summary.byUsagePeriod.push({
        startDate: record.startDate,
        endDate: record.endDate,
        bucket,
        amountUsd: price,
        quality: priceQuality(price),
      });
      continue;
    }

    if (!dailyGranular) continue;

    if (bucket === 'meta_whatsapp') {
      hasDailyMeta = true;
      summary.componentMetaUsd += price;
      if (price < 0) summary.adjustmentWhatsappUsd += price;
    } else if (bucket === 'twilio_whatsapp') {
      hasDailyTwilio = true;
      summary.componentTwilioUsd += price;
      if (price < 0) summary.adjustmentWhatsappUsd += price;
    }

    summary.dailyGranularityAvailable = true;
    const usageDay = record.startDate;
    const prior = summary.byUsageDay.get(usageDay) || {
      usageStartDate: usageDay,
      presentationDayAr: null,
      dayMappingQuality: 'unmapped_usage_date',
      twilioUsd: 0,
      metaUsd: 0,
      whatsappSubtotalUsd: 0,
      twilioQuality: 'unavailable',
      metaQuality: 'unavailable',
      subtotalQuality: 'unavailable',
    };
    if (bucket === 'meta_whatsapp') {
      prior.metaUsd += price;
      prior.metaQuality = priceQuality(price);
    } else if (bucket === 'twilio_whatsapp') {
      prior.twilioUsd += price;
      prior.twilioQuality = priceQuality(price);
    }
    prior.whatsappSubtotalUsd = round4(prior.whatsappSubtotalUsd + price);
    prior.twilioUsd = round4(prior.twilioUsd);
    prior.metaUsd = round4(prior.metaUsd);
    prior.subtotalQuality = priceQuality(prior.whatsappSubtotalUsd);
    summary.byUsageDay.set(usageDay, prior);
  }

  summary.whatsappTwilioPlatformUsd = hasDailyTwilio ? summary.componentTwilioUsd : null;
  summary.whatsappMetaPassthroughUsd = hasDailyMeta ? summary.componentMetaUsd : null;

  if (hasDailyTwilio || hasDailyMeta) {
    summary.whatsappSubtotalUsd = round4(summary.componentTwilioUsd + summary.componentMetaUsd);
  } else if (hasPeriodAggregate) {
    summary.whatsappSubtotalUsd = round4(summary.periodAggregateWhatsappUsd);
  } else {
    summary.whatsappSubtotalUsd = null;
  }

  summary.componentTwilioUsd = round4(summary.componentTwilioUsd);
  summary.componentMetaUsd = round4(summary.componentMetaUsd);
  summary.periodAggregateWhatsappUsd = round4(summary.periodAggregateWhatsappUsd);
  summary.prepaidRechargeUsd = round4(summary.prepaidRechargeUsd);
  summary.excludedNonWhatsappUsd = round4(summary.excludedNonWhatsappUsd);
  summary.excludedUnknownWhatsappUsd = round4(summary.excludedUnknownWhatsappUsd);
  summary.adjustmentWhatsappUsd = round4(summary.adjustmentWhatsappUsd);
  if (summary.accountTotalUsd != null) summary.accountTotalUsd = round4(summary.accountTotalUsd);
  if (summary.whatsappTwilioPlatformUsd != null) {
    summary.whatsappTwilioPlatformUsd = round4(summary.whatsappTwilioPlatformUsd);
  }
  if (summary.whatsappMetaPassthroughUsd != null) {
    summary.whatsappMetaPassthroughUsd = round4(summary.whatsappMetaPassthroughUsd);
  }

  summary.billingCompleteness = resolveBillingCompleteness({
    hasDailyComponents: hasDailyTwilio || hasDailyMeta,
    hasPeriodAggregates: hasPeriodAggregate,
    excludedUnknownWhatsappUsd: summary.excludedUnknownWhatsappUsd,
    hasAccountTotal,
  });

  return {
    ...summary,
    daily: summary.dailyGranularityAvailable
      ? [...summary.byUsageDay.values()].sort((a, b) => String(a.usageStartDate).localeCompare(String(b.usageStartDate)))
      : [],
  };
}

export async function fetchTwilioUsageRecords(input) {
  const {
    accountSid,
    authToken,
    startDate,
    endDate,
    timeoutMs = 15000,
    maxPages = 3,
    request,
  } = input;

  if (!accountSid || !authToken) {
    return { ok: false, error: 'not_configured', records: [], summary: null, truncated: false };
  }
  if (!startDate || !endDate) {
    return { ok: false, error: 'missing_date_range', records: [], summary: null, truncated: false };
  }

  const call = (url) => (request
    ? request({ url })
    : defaultRequest({ url, accountSid, authToken, timeoutMs }));

  const records = [];
  let url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Usage/Records.json?StartDate=${encodeURIComponent(startDate)}&EndDate=${encodeURIComponent(endDate)}&PageSize=100`;
  let pages = 0;

  try {
    while (url && pages < maxPages) {
      const response = await call(url);
      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          error: `usage_query_failed_${response.status}`,
          records,
          summary: records.length ? summarizeUsageRecords(records) : null,
          truncated: false,
          fetchCompleteness: 'failed',
        };
      }
      const batch = Array.isArray(response.data?.usage_records)
        ? response.data.usage_records
        : [];
      records.push(...batch);
      const nextUrl = resolveTwilioNextPageUrl(response.data?.next_page_uri, accountSid);
      url = nextUrl;
      pages += 1;
    }
    const truncated = Boolean(url);
    const summary = summarizeUsageRecords(records);
    return {
      ok: true,
      error: null,
      records,
      summary,
      truncated,
      fetchCompleteness: truncated ? 'partial_truncated' : 'complete_within_page_limit',
    };
  } catch (error) {
    return { ok: false, error: safeError(error).message, records, summary: null, truncated: false, fetchCompleteness: 'failed' };
  }
}