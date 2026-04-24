import cors from 'cors';

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

/**
 * CORS basado en env. En producción usar CORS_ORIGIN (coma-separado).
 * Sin CORS_ORIGIN en desarrollo: solo localhost/127.0.0.1.
 */
export function createCorsMiddleware() {
  const isProd = process.env.NODE_ENV === 'production';
  const raw = process.env.CORS_ORIGIN;

  if (raw && String(raw).trim()) {
    const allowed = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    return cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (allowed.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
    });
  }

  if (isProd) {
    return cors({ origin: false });
  }

  return cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (LOCALHOST_ORIGIN_RE.test(origin)) return cb(null, true);
      return cb(null, false);
    },
  });
}
