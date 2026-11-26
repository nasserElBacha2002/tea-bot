import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import { resolveEffectiveBillingPeriod } from '../monitoring/whatsapp-effective-period.js';
import { getWhatsAppBillingDashboard } from '../monitoring/whatsapp-billing-dashboard.service.js';

export class WhatsAppBillingAggregateService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.lastRunAt = null;
    this.lastStatus = null;
    this.lastErrorAt = null;
  }

  dbEnabled() {
    return isConversationDbEnabled();
  }

  enabled() {
    return config.billingAggregateEnabled && this.dbEnabled();
  }

  start() {
    if (this.timer || !this.enabled()) return;
    const intervalMs = Math.max(1, config.billingAggregateIntervalHours) * 60 * 60 * 1000;
    console.log(`[BillingAggregate] enabled intervalHours=${config.billingAggregateIntervalHours}`);
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.running || !this.enabled()) return;
    this.running = true;
    const startedAt = new Date().toISOString();
    try {
      const dayPeriods = ['yesterday', '7d'];
      for (const period of dayPeriods) {
        const resolved = resolveEffectiveBillingPeriod({ period, persistAggregates: true });
        if (!resolved.ok) continue;
        // eslint-disable-next-line no-await-in-loop
        await getWhatsAppBillingDashboard({
          days: resolved.days,
          asOf: resolved.asOf,
          period: resolved.period,
          fetchUsage: false,
          persistAggregates: true,
          effectiveWindow: resolved.window,
        });
      }
      this.lastRunAt = startedAt;
      this.lastStatus = 'OK';
    } catch (error) {
      this.lastStatus = 'FAILED';
      this.lastErrorAt = new Date().toISOString();
      console.error(`[BillingAggregate] failed: ${error.message}`);
    } finally {
      this.running = false;
    }
  }
}

const whatsappBillingAggregateService = new WhatsAppBillingAggregateService();
export default whatsappBillingAggregateService;