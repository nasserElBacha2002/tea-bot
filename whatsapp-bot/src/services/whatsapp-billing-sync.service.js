import { config } from '../config.js';
import { resolveEffectiveBillingPeriod } from '../monitoring/whatsapp-effective-period.js';
import { getWhatsAppBillingDashboard } from '../monitoring/whatsapp-billing-dashboard.service.js';

export class WhatsAppBillingSyncService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.lastRunAt = null;
    this.lastStatus = null;
    this.lastErrorAt = null;
  }

  enabled() {
    return config.billingTwilioSyncEnabled && config.monitoringTwilioEnabled;
  }

  start() {
    if (this.timer || !this.enabled()) return;
    const intervalMs = Math.max(1, config.billingTwilioSyncIntervalMinutes) * 60 * 1000;
    console.log(`[BillingTwilioSync] enabled intervalMin=${config.billingTwilioSyncIntervalMinutes}`);
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
      const resolved = resolveEffectiveBillingPeriod({
        period: 'current_month',
        fetchUsage: true,
        persistAggregates: false,
      });
      if (resolved.ok) {
        await getWhatsAppBillingDashboard({
          days: resolved.days,
          asOf: resolved.asOf,
          period: resolved.period,
          fetchUsage: true,
          persistAggregates: false,
          effectiveWindow: resolved.window,
        });
      }
      this.lastRunAt = startedAt;
      this.lastStatus = 'OK';
    } catch (error) {
      this.lastStatus = 'FAILED';
      this.lastErrorAt = new Date().toISOString();
      console.error(`[BillingTwilioSync] failed: ${error.message}`);
    } finally {
      this.running = false;
    }
  }
}

const whatsappBillingSyncService = new WhatsAppBillingSyncService();
export default whatsappBillingSyncService;