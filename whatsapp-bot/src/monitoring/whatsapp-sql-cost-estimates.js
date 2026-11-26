import { isConversationDbEnabled } from '../db/index.js';
import { countWhatsappOutboundProxyMonthToDate } from './whatsapp-billing.repository.js';
import {
  buildSqlCostEstimatePack,
  mapCostEstimateToAuditDaily,
} from './whatsapp-cost-engine.js';

export async function resolveSqlCostEstimatesForMetrics(metrics) {
  let priorMonthProxy = { count: null, quality: 'unavailable' };
  const monthKey = metrics?.window?.startDayAr?.slice(0, 7);
  if (monthKey && metrics?.window?.startDayAr && isConversationDbEnabled()) {
    priorMonthProxy = await countWhatsappOutboundProxyMonthToDate(monthKey, metrics.window.startDayAr);
  } else if (metrics?.window?.startDayAr?.endsWith('-01')) {
    priorMonthProxy = { count: 0, quality: 'sql_service_proxy' };
  }
  return buildSqlCostEstimatePack(metrics, priorMonthProxy);
}

export function auditDailyEstimatesFromPack(metrics, estimatesPack) {
  const byDay = new Map((metrics?.daily || []).map((row) => [row.dayAr, row]));
  return (estimatesPack.daily || []).map((estimated) => mapCostEstimateToAuditDaily(
    estimated,
    byDay.get(estimated.dayAr),
  ));
}

export default {
  resolveSqlCostEstimatesForMetrics,
  auditDailyEstimatesFromPack,
};