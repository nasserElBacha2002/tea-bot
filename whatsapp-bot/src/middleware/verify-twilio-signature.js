import twilio from 'twilio';
import { config } from '../config.js';

function firstHeader(req, name) {
  const value = req.get(name);
  if (!value) return '';
  return String(value).split(',')[0].trim();
}

/**
 * Public URL Twilio signed. APP_BASE_URL wins when it is set, because that is
 * the URL configured on the Twilio webhook. Otherwise the first forwarded
 * proto/host is used so a reverse proxy does not force req.protocol=http.
 */
export function resolveTwilioRequestUrl(req) {
  const pathAndQuery = req.originalUrl || req.url || '';
  const explicit = String(process.env.APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return `${explicit}${pathAndQuery}`;
  const proto = firstHeader(req, 'x-forwarded-proto') || req.protocol || 'http';
  const host = firstHeader(req, 'x-forwarded-host') || req.get('host') || '';
  return `${proto}://${host}${pathAndQuery}`;
}

export function verifyTwilioSignature(req, res, next) {
  const token = config.twilioAuthToken;
  const signature = req.get('x-twilio-signature');
  if (!token || !signature) {
    return res.status(403).type('text/plain').send('Forbidden');
  }
  let valid = false;
  try {
    valid = twilio.validateRequest(token, signature, resolveTwilioRequestUrl(req), req.body || {});
  } catch (error) {
    console.error(`[Twilio] signature validation failed: ${error.message}`);
    valid = false;
  }
  if (!valid) {
    return res.status(403).type('text/plain').send('Forbidden');
  }
  return next();
}
