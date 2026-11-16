import axios from 'axios';

const RECHARGE_CATEGORY = /top-?up|recharge|payments?/i;
const META_PASS_THROUGH_CATEGORY = /channels-whatsapp-(?:conversation|template)/i;
const TWILIO_WHATSAPP_CATEGORY = /^channels-whatsapp-(?:outbound|inbound)$/i;
const SMS_MMS_CATEGORY = /^(?:sms|mms)(?:-|$|\.)/i;

function safeError(error) {
  const status = error?.response?.status || null;
  const message = error?.response?.data?.message || error?.message || 'twilio_request_failed';
  return { status, message: String(message).slice(0, 200) };
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

/**
 * Categorías Twilio conocidas. Lo no clasificado explícitamente no se atribuye a Meta.
 */
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
    confirmedTwilioUsd: null,
    confirmedMetaUsd: null,
    confirmedTotalControlUsd: null,
    controlTotalFromProviderUsd: null,
    componentTwilioUsd: 0,
    componentMetaUsd: 0,
    periodAggregateWhatsappUsd: 0,
    prepaidRechargeUsd: 0,
    excludedNonWhatsappUsd: 0,
    excludedUnknownWhatsappUsd: 0,
    categories: [],
    byUsageDay: new Map(),
    dailyGranularityAvailable: false,
    rollupPolicy:
      'Solo registros diarios (start=end) alimentan desglose; agregados de período no se suman con componentes.',
    usageDateTimezoneNote:
      'start_date de Twilio es fecha de usage del proveedor (UTC/calendario Twilio), no día civil Argentina.',
  };

  let hasDailyTwilio = false;
  let hasDailyMeta = false;
  let dailyTwilioSum = 0;
  let dailyMetaSum = 0;

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
    });

    if (bucket === 'prepaid_recharge') {
      summary.prepaidRechargeUsd += price;
      continue;
    }
    if (bucket === 'control_total') {
      summary.controlTotalFromProviderUsd = price;
      continue;
    }
    if (bucket === 'excluded_unknown_whatsapp') {
      if (price !== 0) summary.excludedUnknownWhatsappUsd += price;
      continue;
    }
    if (!whatsappScope) {
      if (price !== 0) summary.excludedNonWhatsappUsd += price;
      continue;
    }
    if (!billableSpend) continue;

    if (aggregated) {
      summary.periodAggregateWhatsappUsd += price;
      continue;
    }

    if (!dailyGranular) continue;

    if (bucket === 'meta_whatsapp') {
      hasDailyMeta = true;
      dailyMetaSum += price;
    } else if (bucket === 'twilio_whatsapp') {
      hasDailyTwilio = true;
      dailyTwilioSum += price;
    }

    summary.dailyGranularityAvailable = true;
    const usageDay = record.startDate;
    const prior = summary.byUsageDay.get(usageDay) || {
      usageStartDate: usageDay,
      presentationDayAr: null,
      dayMappingQuality: 'unmapped_usage_date',
      twilioUsd: 0,
      metaUsd: 0,
      totalUsd: 0,
      twilioQuality: 'unavailable',
      metaQuality: 'unavailable',
      totalQuality: 'unavailable',
    };
    if (bucket === 'meta_whatsapp') {
      prior.metaUsd += price;
      prior.metaQuality = price === 0 ? 'confirmed_zero' : 'confirmed_provider';
    } else if (bucket === 'twilio_whatsapp') {
      prior.twilioUsd += price;
      prior.twilioQuality = price === 0 ? 'confirmed_zero' : 'confirmed_provider';
    }
    prior.totalUsd += price;
    prior.totalQuality = price === 0 ? 'confirmed_zero' : 'confirmed_provider';
    summary.byUsageDay.set(usageDay, prior);
  }

  summary.componentTwilioUsd = dailyTwilioSum;
  summary.componentMetaUsd = dailyMetaSum;
  summary.confirmedTwilioUsd = hasDailyTwilio ? dailyTwilioSum : null;
  summary.confirmedMetaUsd = hasDailyMeta ? dailyMetaSum : null;

  if (summary.controlTotalFromProviderUsd != null) {
    summary.confirmedTotalControlUsd = summary.controlTotalFromProviderUsd;
  } else if (hasDailyTwilio || hasDailyMeta) {
    summary.confirmedTotalControlUsd = dailyTwilioSum + dailyMetaSum;
  } else if (summary.periodAggregateWhatsappUsd > 0) {
    summary.confirmedTotalControlUsd = summary.periodAggregateWhatsappUsd;
  } else {
    summary.confirmedTotalControlUsd = null;
  }

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
          completeness: 'failed',
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
      completeness: truncated ? 'partial_truncated' : 'complete_within_page_limit',
    };
  } catch (error) {
    return { ok: false, error: safeError(error).message, records, summary: null, truncated: false, completeness: 'failed' };
  }
}