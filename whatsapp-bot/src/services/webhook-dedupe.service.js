import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logPerf, nowMs, roundMs } from '../utils/perf-timer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_PATH = path.join(__dirname, '../../data/webhook-processed-ids.json');
const MAX_IDS = 5000;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

class WebhookDedupeService {
  constructor() {
    /** @type {{ ids: Record<string, string> }} */
    this.store = { ids: {} };
    this.loaded = false;
    this.lastPersistBytes = 0;
  }

  buildProviderMessageKey(provider, messageId) {
    if (!provider || !messageId) return '';
    return `${provider}:${messageId}`;
  }

  async ensureLoaded(perfContext = null) {
    const start = nowMs();
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      this.store = { ids: parsed?.ids && typeof parsed.ids === 'object' ? parsed.ids : {} };
      this.lastPersistBytes = Buffer.byteLength(raw, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
        this.store = { ids: {} };
        await this.persist(perfContext);
      } else {
        throw err;
      }
    }
    this.loaded = true;
    await this.prune(perfContext);
    const ms = roundMs(nowMs() - start);
    perfContext?.add?.('dedupeEnsureLoadedMs', ms);
    logPerf('dedupe_ensure_loaded', { ms, ids: Object.keys(this.store.ids || {}).length });
  }

  async persist(perfContext = null) {
    const start = nowMs();
    const payload = JSON.stringify(this.store, null, 2);
    this.lastPersistBytes = Buffer.byteLength(payload, 'utf-8');
    await fs.writeFile(STORE_PATH, payload, 'utf-8');
    const ms = roundMs(nowMs() - start);
    perfContext?.add?.('dedupePersistMs', ms);
    logPerf('dedupe_persist', {
      ms,
      ids: Object.keys(this.store.ids || {}).length,
      bytes: this.lastPersistBytes,
    });
  }

  async prune(perfContext = null) {
    const now = Date.now();
    const entries = Object.entries(this.store.ids || {});
    const kept = entries.filter(([, iso]) => {
      const t = new Date(iso).getTime();
      return !Number.isNaN(t) && now - t < TTL_MS;
    });
    let ids = Object.fromEntries(kept);
    const keys = Object.keys(ids);
    if (keys.length > MAX_IDS) {
      const sorted = [...Object.entries(ids)].sort(
        (a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime(),
      );
      ids = Object.fromEntries(sorted.slice(0, MAX_IDS));
    }
    this.store.ids = ids;
    await this.persist(perfContext);
  }

  /**
   * @returns {Promise<boolean>} true si ya estaba procesado (duplicado)
   */
  async isDuplicate(messageId, perfContext = null) {
    const start = nowMs();
    if (!messageId || typeof messageId !== 'string') return false;
    await this.ensureLoaded(perfContext);
    const duplicate = Object.prototype.hasOwnProperty.call(this.store.ids, messageId);
    const ms = roundMs(nowMs() - start);
    perfContext?.add?.('dedupeCheckMs', ms);
    logPerf('dedupe_check', { ms, duplicate });
    return duplicate;
  }

  /**
   * Marca un id como visto (llamar solo si !isDuplicate).
   */
  async markProcessed(messageId, perfContext = null) {
    const start = nowMs();
    if (!messageId || typeof messageId !== 'string') return;
    await this.ensureLoaded(perfContext);
    this.store.ids[messageId] = new Date().toISOString();
    await this.persist(perfContext);
    const ms = roundMs(nowMs() - start);
    perfContext?.add?.('dedupeMarkMs', ms);
    logPerf('dedupe_mark_processed', { ms, ids: Object.keys(this.store.ids || {}).length });
  }
}

export default new WebhookDedupeService();
