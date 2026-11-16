import axios from 'axios';

const RECHARGE_CATEGORY = /top-?up|recharge|payments?/i;
const META_PASS_THROUGH_CATEGORY = /channels-whatsapp-(?:conversation|template)/i;
const TWILIO_WHATSAPP_CATEGORY = /^channels-whatsapp-(?:outbound|inbound)/i;
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

export function classifyUsageRecord(record) {
  const category = String(record.category || '').toLowerCase();
  if (category === 'totalprice' || category === 'total') {
    return { bucket: 'control_total', billableSpend: false, whatsappScope: false };
  }
  if (RECHARGE_CATEGORY.test(category)) {
    return { bucket: 'prepaid_recharge', billableSpend: false, whatsappScope: false };
  }
  if (SMS_MMS_CATEGORY.test(category) || category === 'sms' || category === 'mms') {
    return { bucket: 'excluded_sms_mms', billableSpend: false, whatsappScope: false };
  }
  if (META_PASS_THROUGH_CATEGORY.test(category)) {
    return { bucket: 'meta_whatsapp', billableSpend: true, whatsappScope: true };
  }
  if (TWILIO_WHATSAPP_CATEGORY.test(category)) {
    return { bucket: 'twilio_whatsapp', billableSpend: true, whatsappScope: true };
  }
  if (/^channels-whatsapp/.test(category)) {
    return { bucket: 'meta_whatsapp', billableSpend: true, whatsappScope: true };
  }
  return { bucket: 'excluded_other', billableSpend: false, whatsappScope: false };
}

export function hasDailyUsageGranularity(record) {
  if (!record.startDate) return false;
  if (!record.endDate) return true;
  return record.startDate === record.endDate;
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
    confirmedTwilioUsd: 0,
    confirmedMetaUsd: 0,
    confirmedTotalControlUsd: 0,
    controlTotalFromProviderUsd: null,
    prepaidRechargeUsd: 0,
    excludedNonWhatsappUsd: 0,
    categories: [],
    byDay: new Map(),
    dailyGranularityAvailable: false,
  };

  for (const raw of records) {
    const record = normalizeRecord(raw);
    const { bucket, billableSpend, whatsappScope } = classifyUsageRecord(record);
    const price = record.price ?? 0;
    const dailyGranular = hasDailyUsageGranularity(record);
    summary.categories.push({ ...record, bucket, billableSpend, whatsappScope, dailyGranular });

    if (bucket === 'prepaid_recharge') {
      summary.prepaidRechargeUsd += price;
      continue;
    }
    if (bucket === 'control_total') {
      summary.controlTotalFromProviderUsd = price;
      continue;
    }
    if (!whatsappScope) {
      if (price !== 0) summary.excludedNonWhatsappUsd += price;
      continue;
    }
    if (!billableSpend) continue;

    if (bucket === 'meta_whatsapp') {
      summary.confirmedMetaUsd += price;
    } else if (bucket === 'twilio_whatsapp') {
      summary.confirmedTwilioUsd += price;
    }

    if (dailyGranular && record.startDate) {
      summary.dailyGranularityAvailable = true;
      const day = record.startDate;
      const prior = summary.byDay.get(day) || {
        dayAr: day,
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
      summary.byDay.set(day, prior);
    }
  }

  const partsSum = summary.confirmedTwilioUsd + summary.confirmedMetaUsd;
  summary.confirmedTotalControlUsd = summary.controlTotalFromProviderUsd ?? partsSum;

  return {
    ...summary,
    daily: summary.dailyGranularityAvailable
      ? [...summary.byDay.values()].sort((a, b) => String(a.dayAr).localeCompare(String(b.dayAr)))
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
    return { ok: false, error: safeError(error).message, records, summary: null, truncated: false };
  }
}