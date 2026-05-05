import { config } from '../config.js';
import conversationExportService from './conversationExport.service.js';
import sessionService from './session.service.js';

class ConversationAbandonmentService {
  constructor() {
    this.timer = null;
  }

  isEnabled() {
    return Boolean(config.abandonTrackingEnabled);
  }

  start() {
    if (!this.isEnabled()) return;
    if (this.timer) return;
    const intervalMs = Number(config.abandonSweepIntervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.runSweep();
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(
      `[ConversationAbandonment] enabled timeout=${config.abandonTimeoutMinutes}m interval=${config.abandonSweepIntervalSeconds}s`
    );
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  _isAbandonedSession(session, nowMs) {
    if (!session) return false;
    if (!config.abandonIncludeSimulator && String(session.provider || '').toLowerCase() === 'simulator') {
      return false;
    }
    if (session.exportedAt) return false;
    const last = Date.parse(session.lastMessageAt || session.updatedAt || '');
    if (!Number.isFinite(last)) return false;
    const timeoutMs = Number(config.abandonTimeoutMinutes) * 60 * 1000;
    return nowMs - last >= timeoutMs;
  }

  async runSweep() {
    if (!this.isEnabled()) return { scanned: 0, abandoned: 0 };
    const entries = sessionService.listSessions();
    const nowMs = Date.now();
    let abandoned = 0;

    for (const { userId, session } of entries) {
      if (!this._isAbandonedSession(session, nowMs)) continue;
      const lastNodeId = session.currentNode || session.nodeId || '';
      const res = await conversationExportService.exportFinalizedConversation(
        userId,
        'abandoned',
        {
          flowId: session.flowId || '',
          flowVersion: session.flowVersion || '',
          reason: 'inactivity_timeout',
          lastNodeId,
          requiresHuman: false,
        }
      );
      if (res.exported || res.skipped) {
        abandoned += 1;
        await sessionService.resetSession(userId);
      }
    }

    if (abandoned > 0) {
      console.log(`[ConversationAbandonment] sweep scanned=${entries.length} abandoned=${abandoned}`);
    }
    return { scanned: entries.length, abandoned };
  }
}

const conversationAbandonmentService = new ConversationAbandonmentService();
export default conversationAbandonmentService;
