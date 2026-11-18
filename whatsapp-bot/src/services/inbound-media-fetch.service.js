import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import inboundMediaService from './inbound-media.service.js';
import { publishInboundAttachmentMessageUpdate } from './conversation-message-attachments-notify.service.js';

class InboundMediaFetchService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.nudgePending = false;
  }

  isEnabled() {
    return Boolean(config.inboundMediaEnabled) && isConversationDbEnabled();
  }

  start() {
    if (!this.isEnabled()) return;
    if (this.timer) return;
    const intervalMs = Number(config.inboundMediaSweepIntervalSeconds) * 1000;
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(
      `[InboundMediaFetch] enabled intervalSeconds=${config.inboundMediaSweepIntervalSeconds} batchSize=${config.inboundMediaSweepBatchSize}`,
    );
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  scheduleNudge() {
    if (!this.isEnabled()) return;
    if (this.running) {
      this.nudgePending = true;
      return;
    }
    void this.runOnce();
  }

  async waitForIdle(timeoutMs = 5_000) {
    const started = Date.now();
    while (this.running && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return !this.running;
  }

  async drain() {
    await this.waitForIdle();
    return this.runOnce();
  }

  async runOnce() {
    if (!this.isEnabled()) return { processed: 0, skipped: true };
    if (this.running) return { processed: 0, skipped: true };
    this.running = true;
    let processed = 0;
    try {
      await attachmentRepository.resetStuckDownloading(config.inboundMediaStuckDownloadingSeconds);
      const batch = await attachmentRepository.listRetryableBatch(
        config.inboundMediaSweepBatchSize,
        config.inboundMediaMaxRetries,
      );
      for (const row of batch) {
        const updated = await inboundMediaService.processAttachmentRow(row);
        if (updated?.status === 'stored' || updated?.status === 'failed') {
          await publishInboundAttachmentMessageUpdate(updated.messageId, updated.conversationId);
        }
        processed += 1;
      }
      return { processed, skipped: false };
    } finally {
      this.running = false;
      if (this.nudgePending) {
        this.nudgePending = false;
        void this.runOnce();
      }
    }
  }
}

const inboundMediaFetchService = new InboundMediaFetchService();
export default inboundMediaFetchService;