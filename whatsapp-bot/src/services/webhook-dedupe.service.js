import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
  }

  buildProviderMessageKey(provider, messageId) {
    if (!provider || !messageId) return '';
    return `${provider}:${messageId}`;
  }

  async ensureLoaded() {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      this.store = { ids: parsed?.ids && typeof parsed.ids === 'object' ? parsed.ids : {} };
    } catch (err) {
      if (err.code === 'ENOENT') {
        await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
        this.store = { ids: {} };
        await this.persist();
      } else {
        throw err;
      }
    }
    this.loaded = true;
    await this.prune();
  }

  async persist() {
    await fs.writeFile(STORE_PATH, JSON.stringify(this.store, null, 2), 'utf-8');
  }

  async prune() {
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
    await this.persist();
  }

  /**
   * @returns {Promise<boolean>} true si ya estaba procesado (duplicado)
   */
  async isDuplicate(messageId) {
    if (!messageId || typeof messageId !== 'string') return false;
    await this.ensureLoaded();
    return Object.prototype.hasOwnProperty.call(this.store.ids, messageId);
  }

  /**
   * Marca un id como visto (llamar solo si !isDuplicate).
   */
  async markProcessed(messageId) {
    if (!messageId || typeof messageId !== 'string') return;
    await this.ensureLoaded();
    this.store.ids[messageId] = new Date().toISOString();
    await this.persist();
  }
}

export default new WebhookDedupeService();
