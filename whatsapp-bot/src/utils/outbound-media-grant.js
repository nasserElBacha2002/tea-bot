import crypto from 'node:crypto';
import { config, planTwilioPublicUrl } from '../config.js';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function grantSecret() {
  const secret = String(config.sessionSecret || config.twilioAuthToken || '').trim();
  if (!secret) {
    const err = new Error('OUTBOUND_MEDIA_URL_SECRET_MISSING');
    err.code = 'OUTBOUND_MEDIA_URL_SECRET_MISSING';
    throw err;
  }
  return secret;
}

/**
 * @param {{ storageKey: string, mimeType: string, expiresAtMs?: number }} input
 */
export function createOutboundMediaGrant(input) {
  const storageKey = String(input.storageKey || '').replace(/[/\\]/g, '');
  const mimeType = String(input.mimeType || '').trim().toLowerCase();
  if (!storageKey || !mimeType) throw new Error('grant_invalid');
  const expiresAtMs = Number.isFinite(input.expiresAtMs)
    ? Number(input.expiresAtMs)
    : Date.now() + DEFAULT_TTL_MS;
  const payload = JSON.stringify({ sk: storageKey, mt: mimeType, exp: expiresAtMs });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', grantSecret()).update(payloadB64).digest('base64url');
  return { token: `${payloadB64}.${sig}`, expiresAtMs };
}

/**
 * @param {string} token
 * @returns {{ storageKey: string, mimeType: string, expiresAtMs: number }}
 */
export function verifyOutboundMediaGrant(token) {
  const value = String(token || '').trim();
  if (!value) throw new Error('grant_invalid');
  const dot = value.lastIndexOf('.');
  if (dot <= 0) throw new Error('grant_invalid');
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = crypto.createHmac('sha256', grantSecret()).update(payloadB64).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('grant_invalid');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('grant_invalid');
  }
  const storageKey = String(parsed?.sk || '').replace(/[/\\]/g, '');
  const mimeType = String(parsed?.mt || '').trim().toLowerCase();
  const expiresAtMs = Number(parsed?.exp);
  if (!storageKey || !mimeType || !Number.isFinite(expiresAtMs)) throw new Error('grant_invalid');
  if (Date.now() > expiresAtMs) throw new Error('grant_expired');
  return { storageKey, mimeType, expiresAtMs };
}

/**
 * @param {string} token
 */
export function buildTwilioFetchableOutboundMediaUrl(token) {
  const plan = planTwilioPublicUrl();
  if (!plan.ok || !plan.origin) {
    const err = new Error('PUBLIC_URL_UNCONFIGURED');
    err.code = 'PUBLIC_URL_UNCONFIGURED';
    throw err;
  }
  const prefix = plan.publicPrefix || '';
  const encoded = encodeURIComponent(token);
  return `${plan.origin}${prefix}/media/outbound/${encoded}`;
}