const ALLOWED_HOSTS = new Set([
  'api.twilio.com',
  'media.twiliocdn.com',
]);

const MAX_REDIRECTS = 5;

export function isTwilioMediaUrlAllowed(raw) {
  try {
    assertTwilioMediaUrl(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} raw
 * @returns {string} canonical href
 */
export function assertTwilioMediaUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('url_not_allowed');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('url_not_allowed');
  }
  if (parsed.protocol !== 'https:') throw new Error('url_not_allowed');
  if (parsed.username || parsed.password || parsed.hash) throw new Error('url_not_allowed');
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) throw new Error('url_not_allowed');
  return parsed.href;
}

/**
 * Descarga con redirecciones validadas. No envía credenciales fuera del primer hop Twilio.
 * @param {string} startUrl
 * @param {{
 *   authHeader: string,
 *   timeoutMs: number,
 *   maxBytes: number,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function fetchTwilioMediaWithRedirects(startUrl, options) {
  const fetchImpl = options.fetchImpl || fetch;
  assertTwilioMediaUrl(startUrl);
  let current = startUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const headers = hop === 0 ? { Authorization: options.authHeader } : {};
      const response = await fetchImpl(current, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('redirect_invalid');
        current = assertTwilioMediaUrl(new URL(location, current).href);
        continue;
      }
      if (!response.ok) {
        const err = new Error(`download_http_${response.status}`);
        err.httpStatus = response.status;
        throw err;
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        throw new Error('size_limit_exceeded');
      }
      const chunks = [];
      let total = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          const piece = Buffer.from(chunk);
          total += piece.length;
          if (total > options.maxBytes) throw new Error('size_limit_exceeded');
          chunks.push(piece);
        }
      }
      if (total === 0) throw new Error('content_empty');
      const resolvedMime = String(response.headers.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      return {
        buffer: Buffer.concat(chunks),
        byteSize: total,
        resolvedMime: resolvedMime || null,
        finalUrl: current,
      };
    }
    throw new Error('redirect_limit');
  } finally {
    clearTimeout(timeout);
  }
}