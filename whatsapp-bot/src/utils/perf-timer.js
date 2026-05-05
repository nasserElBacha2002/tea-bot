import { performance } from 'node:perf_hooks';

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isPerfEnabled() {
  return parseBool(process.env.PERF_LOG_ENABLED, false);
}

export function nowMs() {
  return performance.now();
}

export function roundMs(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(3));
}

export function shouldSample() {
  const rate = Math.min(1, Math.max(0, parseNumber(process.env.PERF_LOG_SAMPLE_RATE, 1)));
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() <= rate;
}

export function getSlowThresholdMs() {
  return Math.max(1, parseNumber(process.env.PERF_LOG_SLOW_MS, 500));
}

export function maskId(value) {
  const text = String(value || '');
  if (!text) return 'unknown';
  if (text.length <= 6) return `${text.slice(0, 1)}***`;
  return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

export function logPerf(eventName, data = {}, options = {}) {
  const enabled = isPerfEnabled();
  const totalMs = Number(data.totalMs ?? data.ms ?? 0);
  const slow = Number.isFinite(totalMs) && totalMs >= getSlowThresholdMs();
  if (!enabled && !options.force && !slow) return;
  if (!slow && !options.force && !shouldSample()) return;

  try {
    const payload = {
      ts: new Date().toISOString(),
      event: eventName,
      ...data,
    };
    console.log(`[PERF] ${JSON.stringify(payload)}`);
  } catch {
    // Never break normal flow because of perf logging
  }
}

export async function measureAsync(label, fn, extra = {}) {
  const start = nowMs();
  try {
    const result = await fn();
    const ms = roundMs(nowMs() - start);
    logPerf(label, { ...extra, ms });
    return result;
  } catch (error) {
    const ms = roundMs(nowMs() - start);
    logPerf(label, { ...extra, ms, error: error?.message || 'unknown_error' }, { force: true });
    throw error;
  }
}

export function measureSync(label, fn, extra = {}) {
  const start = nowMs();
  try {
    const result = fn();
    const ms = roundMs(nowMs() - start);
    logPerf(label, { ...extra, ms });
    return result;
  } catch (error) {
    const ms = roundMs(nowMs() - start);
    logPerf(label, { ...extra, ms, error: error?.message || 'unknown_error' }, { force: true });
    throw error;
  }
}

export function createPerfContext(base = {}) {
  const marks = {};
  return {
    ...base,
    marks,
    add(name, value) {
      marks[name] = value;
    },
    inc(name, value = 1) {
      marks[name] = Number(marks[name] || 0) + value;
    },
    toJSON() {
      return { ...base, ...marks };
    },
  };
}
