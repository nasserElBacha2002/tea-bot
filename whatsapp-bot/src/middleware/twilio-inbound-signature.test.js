import http from 'http';
import express from 'express';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { config, resolveTwilioSignatureMode } from '../config.js';
import { settleTwilioInbound } from '../controllers/twilio-webhook.controller.js';
import monitoringService from '../monitoring/monitoring.service.js';
import twilioWebhookRouter from '../routes/twilio-webhook.routes.js';
import {
  evaluateTwilioInboundSignature,
  rememberUrlencodedBody,
  twilioWebhookBodyError,
  verifyTwilioInboundSignature,
} from './verify-twilio-signature.js';

const TOKEN = 'tb005-test-auth-token';
const BASE = 'https://bot.example';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signatureFor(url, params) {
  return twilio.getExpectedTwilioSignature(TOKEN, url, params);
}

function restoreEnv(snapshot) {
  config.twilioAuthToken = snapshot.token;
  if (snapshot.mode == null) delete process.env.TWILIO_SIGNATURE_MODE;
  else process.env.TWILIO_SIGNATURE_MODE = snapshot.mode;
  if (snapshot.base == null) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = snapshot.base;
  if (snapshot.prefix == null) delete process.env.TWILIO_PUBLIC_PATH_PREFIX;
  else process.env.TWILIO_PUBLIC_PATH_PREFIX = snapshot.prefix;
  if (snapshot.envToken == null) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = snapshot.envToken;
}

function useSignatureEnv(t, { mode, base = BASE, prefix, token = TOKEN } = {}) {
  const snapshot = {
    token: config.twilioAuthToken,
    mode: process.env.TWILIO_SIGNATURE_MODE,
    base: process.env.APP_BASE_URL,
    prefix: process.env.TWILIO_PUBLIC_PATH_PREFIX,
    envToken: process.env.TWILIO_AUTH_TOKEN,
  };
  config.twilioAuthToken = token;
  if (mode == null) delete process.env.TWILIO_SIGNATURE_MODE;
  else process.env.TWILIO_SIGNATURE_MODE = mode;
  if (base == null) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = base;
  if (prefix == null) delete process.env.TWILIO_PUBLIC_PATH_PREFIX;
  else process.env.TWILIO_PUBLIC_PATH_PREFIX = prefix;
  t.after(() => restoreEnv(snapshot));
}

function captureLogs(t) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.map((item) => String(item)).join(' '));
  };
  t.after(() => {
    console.log = original;
  });
  return {
    events() {
      return lines.flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          return parsed?.event ? [parsed] : [];
        } catch {
          return [];
        }
      });
    },
    text() {
      return lines.join('\n');
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function post(server, { path, params, headers = {}, rawBody, contentType }) {
  const body = rawBody ?? new URLSearchParams(params || {}).toString();
  return new Promise((resolve, reject) => {
    const req = http.request({
      port: server.address().port,
      host: '127.0.0.1',
      path,
      method: 'POST',
      headers: {
        'content-type': contentType || 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function inboundApp(calls) {
  const app = express();
  app.use(express.urlencoded({ extended: false, verify: rememberUrlencodedBody }));
  app.post('/webhooks/twilio/:flowId', verifyTwilioInboundSignature, (req, res) => {
    calls.push({ body: req.body, path: req.originalUrl });
    res.status(200).type('text/xml').send('<Response><Message>ok</Message></Response>');
  });
  app.use(twilioWebhookBodyError);
  return app;
}

function assertSafeLog(logs, { signature, phone, querySecret }) {
  const text = logs.text();
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes('tb005-test-auth-token'), false);
  if (signature) assert.equal(text.includes(signature), false);
  if (phone) assert.equal(text.includes(phone), false);
  if (querySecret) assert.equal(text.includes(querySecret), false);
  for (const event of logs.events()) {
    if (!String(event.event).startsWith('twilio_signature')) continue;
    assert.match(event.correlationId, UUID);
    assert.equal(JSON.stringify(event.url || {}).includes('?'), false);
  }
}

describe('TB-005 firma inbound de Twilio', { concurrency: 1 }, () => {
  test('la ruta inbound usa el modo y el callback de estado sigue estricto', () => {
    const routes = twilioWebhookRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        handlers: layer.route.stack.map((item) => item.handle.name),
      }));
    const inbound = routes.find((route) => route.path === '/:flowId');
    const status = routes.find((route) => route.path === '/:flowId/status');
    assert.deepEqual(inbound.handlers, ['verifyTwilioInboundSignature', 'receiveTwilioMessage']);
    assert.deepEqual(status.handlers, ['verifyTwilioSignature', 'receiveTwilioStatus']);
  });

  test('T01 firma valida en enforce entra al controlador', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1';
    const params = { MessageSid: 'SM-T01', From: 'whatsapp:+5491100000001', Body: 'hola' };
    const signature = signatureFor(`${BASE}${path}`, params);
    const response = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': signature },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(logs.events().some((event) => event.event === 'twilio_signature_valid'), true);
    assertSafeLog(logs, { signature, phone: '+5491100000001' });
  });

  test('T02 firma invalida en enforce responde 403 sin entrar', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const signature = 'not-a-valid-signature';
    const response = await post(server, {
      path: '/webhooks/twilio/flow-1',
      params: { MessageSid: 'SM-T02', From: 'whatsapp:+5491100000002', Body: 'hola' },
      headers: { 'x-twilio-signature': signature },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body, 'Forbidden');
    assert.equal(calls.length, 0);
    const event = logs.events().find((item) => item.event === 'twilio_signature_invalid');
    assert.equal(event.result, 'invalid');
    assert.equal(event.mode, 'enforce');
    assert.equal(event.route, '/webhooks/twilio/flow-1');
    assertSafeLog(logs, { signature, phone: '+5491100000002' });
  });

  test('T03 firma ausente en enforce responde 403 sin entrar', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await post(server, {
      path: '/webhooks/twilio/flow-1',
      params: { MessageSid: 'SM-T03', From: 'whatsapp:+5491100000003', Body: 'hola' },
    });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
    assert.equal(logs.events()[0].event, 'twilio_signature_missing');
    assertSafeLog(logs, { phone: '+5491100000003' });
  });

  test('T04 firma invalida en log se registra y se procesa', async (t) => {
    useSignatureEnv(t, { mode: 'log' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await post(server, {
      path: '/webhooks/twilio/flow-1',
      params: { MessageSid: 'SM-T04', From: 'whatsapp:+5491100000004', Body: 'hola' },
      headers: { 'x-twilio-signature': 'invalid-signature' },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(logs.events()[0].event, 'twilio_signature_invalid');
    assert.equal(logs.events()[0].mode, 'log');
    assertSafeLog(logs, { signature: 'invalid-signature', phone: '+5491100000004' });
  });

  test('T05 firma valida en log se procesa', async (t) => {
    useSignatureEnv(t, { mode: 'log' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1';
    const params = { MessageSid: 'SM-T05', From: 'whatsapp:+5491100000005', Body: 'café' };
    const signature = signatureFor(`${BASE}${path}`, params);
    const response = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': signature },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.Body, 'café');
    assert.equal(logs.events()[0].event, 'twilio_signature_valid');
    assertSafeLog(logs, { signature, phone: '+5491100000005' });
  });

  test('T06 modo off procesa una firma invalida y registra el modo inseguro', async (t) => {
    useSignatureEnv(t, { mode: 'off' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await post(server, {
      path: '/webhooks/twilio/flow-1',
      params: { MessageSid: 'SM-T06', From: 'whatsapp:+5491100000006', Body: 'hola' },
      headers: { 'x-twilio-signature': 'invalid-signature' },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(logs.events()[0].event, 'twilio_signature_mode_off');
    assert.equal(logs.events()[0].mode, 'off');
    assert.equal(logs.events()[0].reason, 'signature_mode_off');
    assert.equal(resolveTwilioSignatureMode(undefined).mode, 'off');
    assert.equal(resolveTwilioSignatureMode('').mode, 'off');
  });

  test('T07 configuracion invalida no se degrada a off', async (t) => {
    useSignatureEnv(t, { mode: 'strict' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const resolved = resolveTwilioSignatureMode('strict');
    assert.equal(resolved.ok, false);
    assert.equal(resolved.mode, null);
    const response = await post(server, {
      path: '/webhooks/twilio/flow-1',
      params: { MessageSid: 'SM-T07', Body: 'hola' },
    });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
    assert.equal(logs.events()[0].event, 'twilio_signature_configuration_error');
    assert.equal(logs.events()[0].reason, 'invalid_mode');
    assert.notEqual(logs.events()[0].mode, 'off');
  });

  test('T08 sin auth token log y enforce rechazan y no registran el token', async (t) => {
    useSignatureEnv(t, { mode: 'enforce', token: '' });
    process.env.TWILIO_AUTH_TOKEN = 'super-secret-token-value';
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const enforced = await post(server, {
      path: '/webhooks/twilio/flow-1',
      params: { MessageSid: 'SM-T08', From: 'whatsapp:+5491100000008', Body: 'hola' },
      headers: { 'x-twilio-signature': 'anything' },
    });
    assert.equal(enforced.status, 403);
    assert.equal(calls.length, 0);
    process.env.TWILIO_SIGNATURE_MODE = 'log';
    const logged = await post(server, {
      path: '/webhooks/twilio/flow-1',
      params: { MessageSid: 'SM-T08', From: 'whatsapp:+5491100000008', Body: 'hola' },
    });
    assert.equal(logged.status, 403);
    assert.equal(calls.length, 0);
    const reasons = logs.events().map((event) => event.reason);
    assert.deepEqual(reasons, ['missing_auth_token', 'missing_auth_token']);
    assert.equal(logs.text().includes('super-secret-token-value'), false);
    assert.equal(logs.text().includes(TOKEN), false);
  });

  test('T09 la firma https se valida con la URL publica y no con el proto del proxy', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1';
    const params = { MessageSid: 'SM-T09', Body: 'hola', From: 'whatsapp:+5491100000009' };
    const response = await post(server, {
      path,
      params,
      headers: {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'internal.invalid',
        'x-twilio-signature': signatureFor(`${BASE}${path}`, params),
      },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
  });

  test('T10 el prefijo publico de Nginx entra en la URL firmada', async (t) => {
    useSignatureEnv(t, { mode: 'enforce', prefix: '/tea' });
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1';
    const params = { MessageSid: 'SM-T10', Body: 'hola', From: 'whatsapp:+5491100000010' };
    const prefixed = await post(server, {
      path,
      params,
      headers: {
        'x-twilio-signature': signatureFor(`${BASE}/tea${path}`, params),
      },
    });
    assert.equal(prefixed.status, 200);
    const bare = await post(server, {
      path,
      params,
      headers: {
        'x-twilio-signature': signatureFor(`${BASE}${path}`, params),
      },
    });
    assert.equal(bare.status, 403);
    assert.equal(calls.length, 1);
  });

  test('T11 el query string se conserva para la firma y no se registra', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1?b=2&a=1&q=secreto-query';
    const params = { MessageSid: 'SM-T11', Body: 'niño', From: 'whatsapp:+5491100000011' };
    const signature = signatureFor(`${BASE}${path}`, params);
    const response = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': signature },
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.Body, 'niño');
    const event = logs.events()[0];
    assert.equal(event.event, 'twilio_signature_valid');
    assert.equal(event.route, '/webhooks/twilio/flow-1');
    assert.equal(event.url.pathname, '/webhooks/twilio/flow-1');
    assertSafeLog(logs, { signature, phone: '+5491100000011', querySecret: 'secreto-query' });
  });

  test('T12 un X-Forwarded-Host no confiable no cambia la URL validada', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const logs = captureLogs(t);
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1';
    const params = { MessageSid: 'SM-T12', Body: 'hola', From: 'whatsapp:+5491100000012' };
    const spoofed = await post(server, {
      path,
      params,
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
        host: 'evil.example',
        'x-twilio-signature': signatureFor(`https://evil.example${path}`, params),
      },
    });
    assert.equal(spoofed.status, 403);
    assert.equal(calls.length, 0);
    const accepted = await post(server, {
      path,
      params,
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
        host: 'evil.example',
        'x-twilio-signature': signatureFor(`${BASE}${path}`, params),
      },
    });
    assert.equal(accepted.status, 200);
    delete process.env.APP_BASE_URL;
    const unconfigured = await post(server, {
      path,
      params,
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
        'x-twilio-signature': signatureFor(`https://evil.example${path}`, params),
      },
    });
    assert.equal(unconfigured.status, 403);
    assert.equal(calls.length, 1);
    process.env.TWILIO_SIGNATURE_MODE = 'log';
    const logged = await post(server, {
      path,
      params,
      headers: {
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        'x-twilio-signature': signatureFor(`https://evil.example${path}`, params),
      },
    });
    assert.equal(logged.status, 403);
    assert.equal(calls.length, 1);
    const broken = logs.events().filter((event) => event.reason === 'public_url_unconfigured');
    assert.equal(broken.length >= 2, true);
    assert.equal(broken.every((event) => event.event === 'twilio_signature_configuration_error'), true);
    assert.equal(logs.events().some((event) => event.event === 'twilio_signature_valid'), true);
  });

  test('parametros repetidos se firman sin quedarse con el ultimo valor', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1';
    const params = { MessageSid: 'SM-DUP', Tag: ['b', 'a'] };
    const rawBody = 'MessageSid=SM-DUP&Tag=b&Tag=a';
    const response = await post(server, {
      path,
      rawBody,
      headers: { 'x-twilio-signature': signatureFor(`${BASE}${path}`, params) },
    });
    assert.equal(response.status, 200);
    const collapsed = await post(server, {
      path,
      rawBody,
      headers: {
        'x-twilio-signature': signatureFor(`${BASE}${path}`, { MessageSid: 'SM-DUP', Tag: 'a' }),
      },
    });
    assert.equal(collapsed.status, 403);
    assert.equal(calls.length, 1);
  });

  test('T17 el callback de estado exige firma aunque el inbound este en off o log', async (t) => {
    useSignatureEnv(t, { mode: 'off' });
    const calls = [];
    const original = monitoringService.recordDeliveryStatus;
    monitoringService.recordDeliveryStatus = async (body) => {
      calls.push(body);
    };
    t.after(() => {
      monitoringService.recordDeliveryStatus = original;
    });
    const app = express();
    app.use(express.urlencoded({ extended: false, verify: rememberUrlencodedBody }));
    app.use('/webhooks/twilio', twilioWebhookRouter);
    const server = await listen(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1/status';
    const params = {
      MessageSid: 'SM-status-tb005',
      MessageStatus: 'delivered',
      ErrorCode: '',
      ErrorMessage: '',
    };
    for (const mode of ['off', 'log', 'enforce']) {
      process.env.TWILIO_SIGNATURE_MODE = mode;
      const invalid = await post(server, {
        path,
        params,
        headers: { 'x-twilio-signature': 'not-valid' },
      });
      assert.equal(invalid.status, 403, mode);
      const missing = await post(server, { path, params });
      assert.equal(missing.status, 403, mode);
    }
    process.env.TWILIO_SIGNATURE_MODE = 'off';
    const valid = await post(server, {
      path,
      params,
      headers: { 'x-twilio-signature': signatureFor(`${BASE}${path}`, params) },
    });
    assert.equal(valid.status, 200);
    assert.equal(calls.length, 1);
  });

  test('T18 un body malformado no ejecuta el controlador ni responde 500', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const calls = [];
    const server = await listen(inboundApp(calls));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const malformed = await post(server, {
      path: '/webhooks/twilio/flow-1',
      rawBody: Buffer.from([0xff, 0xfe, 0x00, 0xd8]).toString('binary'),
      contentType: 'application/x-www-form-urlencoded; charset=utf-16',
    });
    assert.ok(malformed.status >= 400 && malformed.status < 500);
    assert.equal(calls.length, 0);

    const app = express();
    app.use(express.urlencoded({ extended: false, verify: rememberUrlencodedBody }));
    app.use('/webhooks/twilio', twilioWebhookRouter);
    app.use(twilioWebhookBodyError);
    const real = await listen(app);
    t.after(() => new Promise((resolve) => real.close(resolve)));
    const path = '/webhooks/twilio/flow-1';
    const params = { Unexpected: '%%%' };
    const identified = await post(real, {
      path,
      params,
      headers: { 'x-twilio-signature': signatureFor(`${BASE}${path}`, params) },
    });
    assert.equal(identified.status, 400);
    assert.equal(identified.body.includes('<Message>'), false);
    assert.match(identified.body, /<Response><\/Response>/);
  });

  test('una firma valida con fallo de SQL responde 503 y no 403', async (t) => {
    useSignatureEnv(t, { mode: 'enforce' });
    const path = '/webhooks/twilio/flow-1';
    const params = {
      MessageSid: 'SM-SQL-FAIL',
      Body: 'hola',
      From: 'whatsapp:+5491100000099',
    };
    const entry = evaluateTwilioInboundSignature({
      baseUrl: '',
      path,
      originalUrl: path,
      rawBody: new URLSearchParams(params).toString(),
      get(name) {
        if (String(name).toLowerCase() === 'x-twilio-signature') {
          return signatureFor(`${BASE}${path}`, params);
        }
        return '';
      },
    });
    assert.equal(entry.allow, true);
    assert.equal(entry.result, 'valid');
    const settled = await settleTwilioInbound({
      flowId: 'flow-1',
      body: params,
      begin: async () => {
        throw new Error('sql down');
      },
    });
    assert.equal(settled.httpStatus, 503);
    assert.match(settled.twiml, /<Response><\/Response>/);
  });
});
