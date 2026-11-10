import { randomUUID } from 'node:crypto';
import twilio from 'twilio';
import {
  config,
  planTwilioPublicUrl,
  resolveTwilioSignatureMode,
} from '../config.js';

/**
 * URL que Twilio firmó. Origen y prefijo salen solo de la configuración.
 * La ruta y el query se copian de Express, sin recodificar y sin X-Forwarded-*.
 */
export function resolveInboundSignatureUrl(req, env = process.env) {
  const plan = planTwilioPublicUrl(env);
  if (!plan.ok) return { ok: false, reason: plan.reason, url: null, safe: null };
  const pathAndQuery = String(req.originalUrl || req.url || '');
  if (!pathAndQuery.startsWith('/')) {
    return { ok: false, reason: 'public_url_invalid', url: null, safe: null };
  }
  const url = `${plan.origin}${plan.publicPrefix}${pathAndQuery}`;
  return { ok: true, reason: null, url, safe: safeUrlParts(url) };
}

export function resolveTwilioRequestUrl(req, env = process.env) {
  return resolveInboundSignatureUrl(req, env).url || '';
}

export function verifyTwilioSignature(req, res, next) {
  const token = config.twilioAuthToken;
  const signature = headerSignature(req);
  const target = resolveInboundSignatureUrl(req);
  const params = signatureParams(req);
  if (!token || !signature || !target.ok || !params.ok) {
    return res.status(403).type('text/plain').send('Forbidden');
  }
  let valid = false;
  try {
    valid = twilio.validateRequest(token, signature, target.url, params.params);
  } catch {
    valid = false;
  }
  if (!valid) {
    return res.status(403).type('text/plain').send('Forbidden');
  }
  return next();
}

export function rememberUrlencodedBody(req, _res, buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return;
  req.rawBody = buf.toString('utf8');
}

function safeRoute(req) {
  const combined = `${req.baseUrl || ''}${req.path || ''}`;
  const path = combined || String(req.originalUrl || req.url || '').split('?')[0];
  return path.split('?')[0].slice(0, 256);
}

function safeUrlParts(url) {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.host,
      pathname: parsed.pathname,
    };
  } catch {
    return null;
  }
}

function headerSignature(req) {
  const value = req.get?.('x-twilio-signature');
  if (value == null || String(value).trim() === '') return '';
  return String(value).split(',')[0].trim().slice(0, 512);
}

export function formParamsForSignature(rawBody) {
  const params = Object.create(null);
  const search = new URLSearchParams(rawBody);
  for (const key of search.keys()) {
    if (Object.prototype.hasOwnProperty.call(params, key)) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const values = search.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  return params;
}

function signatureParams(req) {
  if (typeof req.rawBody === 'string') {
    try {
      return { ok: true, params: formParamsForSignature(req.rawBody) };
    } catch {
      return { ok: false, params: null };
    }
  }
  if (req.body == null) return { ok: true, params: {} };
  if (typeof req.body !== 'object' || Array.isArray(req.body)) return { ok: false, params: null };
  return { ok: true, params: req.body };
}

function decision(fields, { allow, httpStatus }) {
  return {
    allow,
    httpStatus,
    event: fields.event,
    route: fields.route,
    mode: fields.mode,
    result: fields.result,
    correlationId: fields.correlationId,
    reason: fields.reason,
    url: fields.url || null,
  };
}

/**
 * Resultado del inbound. No autentica el callback de estado.
 * @param {import('express').Request} req
 * @param {NodeJS.ProcessEnv} [env]
 */
export function evaluateTwilioInboundSignature(req, env = process.env) {
  const modeState = resolveTwilioSignatureMode(env.TWILIO_SIGNATURE_MODE);
  const correlationId = randomUUID();
  const route = safeRoute(req);
  const mode = modeState.ok ? modeState.mode : null;
  const base = { route, correlationId, mode };

  if (!modeState.ok) {
    return decision({
      ...base,
      event: 'twilio_signature_configuration_error',
      result: 'configuration_error',
      reason: 'invalid_mode',
    }, { allow: false, httpStatus: 403 });
  }

  if (modeState.mode === 'off') {
    return decision({
      ...base,
      event: 'twilio_signature_mode_off',
      result: 'bypassed',
      reason: 'signature_mode_off',
    }, { allow: true, httpStatus: 200 });
  }

  if (!config.twilioAuthToken) {
    return decision({
      ...base,
      event: 'twilio_signature_configuration_error',
      result: 'configuration_error',
      reason: 'missing_auth_token',
    }, { allow: false, httpStatus: 403 });
  }

  const target = resolveInboundSignatureUrl(req, env);
  if (!target.ok) {
    return decision({
      ...base,
      event: 'twilio_signature_configuration_error',
      result: 'configuration_error',
      reason: target.reason,
    }, { allow: false, httpStatus: 403 });
  }

  const params = signatureParams(req);
  if (!params.ok) {
    return decision({
      ...base,
      event: 'twilio_signature_configuration_error',
      result: 'configuration_error',
      reason: 'malformed_body',
      url: target.safe,
    }, { allow: false, httpStatus: 400 });
  }

  const signature = headerSignature(req);
  if (!signature) {
    const fields = {
      ...base,
      event: 'twilio_signature_missing',
      result: 'missing',
      reason: 'missing_signature',
      url: target.safe,
    };
    if (modeState.mode === 'log') return decision(fields, { allow: true, httpStatus: 200 });
    return decision(fields, { allow: false, httpStatus: 403 });
  }

  let valid = false;
  try {
    valid = twilio.validateRequest(
      config.twilioAuthToken,
      signature,
      target.url,
      params.params,
    );
  } catch {
    valid = false;
  }

  if (!valid) {
    const fields = {
      ...base,
      event: 'twilio_signature_invalid',
      result: 'invalid',
      reason: 'signature_mismatch',
      url: target.safe,
    };
    if (modeState.mode === 'log') return decision(fields, { allow: true, httpStatus: 200 });
    return decision(fields, { allow: false, httpStatus: 403 });
  }

  return decision({
    ...base,
    event: 'twilio_signature_valid',
    result: 'valid',
    reason: null,
    url: target.safe,
  }, { allow: true, httpStatus: 200 });
}

export function logTwilioSignatureDecision(entry) {
  console.log(JSON.stringify({
    event: entry.event,
    route: entry.route,
    mode: entry.mode,
    result: entry.result,
    correlationId: entry.correlationId,
    reason: entry.reason,
    ...(entry.url ? { url: entry.url } : {}),
  }));
}

export function verifyTwilioInboundSignature(req, res, next) {
  const entry = evaluateTwilioInboundSignature(req);
  logTwilioSignatureDecision(entry);
  if (!entry.allow) {
    const body = entry.httpStatus === 400 ? 'Bad Request' : 'Forbidden';
    return res.status(entry.httpStatus).type('text/plain').send(body);
  }
  return next();
}

export function twilioWebhookBodyError(err, req, res, next) {
  const url = String(req.originalUrl || req.url || '');
  if (!url.startsWith('/webhooks/twilio')) return next(err);
  const status = Number(err?.status || err?.statusCode || 0);
  const type = String(err?.type || '');
  const parseError = type === 'entity.parse.failed'
    || type === 'encoding.unsupported'
    || type === 'entity.too.large'
    || type === 'request.aborted'
    || status === 400
    || status === 413
    || status === 415;
  if (!parseError) return next(err);
  const modeState = resolveTwilioSignatureMode();
  logTwilioSignatureDecision({
    event: 'twilio_signature_configuration_error',
    route: url.split('?')[0].slice(0, 256),
    mode: modeState.ok ? modeState.mode : null,
    result: 'configuration_error',
    correlationId: randomUUID(),
    reason: 'malformed_body',
  });
  const httpStatus = status >= 400 && status < 500 ? status : 400;
  return res.status(httpStatus).type('text/plain').send('Bad Request');
}
