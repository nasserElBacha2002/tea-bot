import http from 'http';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { config } from '../config.js';
import { createApp } from '../create-app.js';
import monitoringService from '../monitoring/monitoring.service.js';

const TOKEN = 'tb005-app-auth-token';
const BASE = 'https://bot.example';

function restoreEnv(snapshot) {
  config.twilioAuthToken = snapshot.token;
  if (snapshot.mode == null) delete process.env.TWILIO_SIGNATURE_MODE;
  else process.env.TWILIO_SIGNATURE_MODE = snapshot.mode;
  if (snapshot.base == null) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = snapshot.base;
  if (snapshot.prefix == null) delete process.env.TWILIO_PUBLIC_PATH_PREFIX;
  else process.env.TWILIO_PUBLIC_PATH_PREFIX = snapshot.prefix;
}

function useEnv(t, { mode, base = BASE, prefix, token = TOKEN } = {}) {
  const snapshot = {
    token: config.twilioAuthToken,
    mode: process.env.TWILIO_SIGNATURE_MODE,
    base: process.env.APP_BASE_URL,
    prefix: process.env.TWILIO_PUBLIC_PATH_PREFIX,
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

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function post(server, { path, params, rawBody, headers = {}, contentType }) {
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

describe('TB-005 ensamblado HTTP real', { concurrency: 1 }, () => {
  test('el orden es json, urlencoded, rutas y el error handler de Twilio', () => {
    const names = createApp()._router.stack.map((layer) => layer.name);
    const jsonAt = names.indexOf('jsonParser');
    const urlAt = names.indexOf('urlencodedParser');
    const errorAt = names.lastIndexOf('twilioWebhookBodyError');
    assert.ok(jsonAt >= 0);
    assert.ok(urlAt > jsonAt);
    assert.ok(errorAt > urlAt);
    assert.ok(names.some((name) => name === 'router'));
  });

  test('una firma inválida en enforce no entra al TwiML del turno', async (t) => {
    useEnv(t, { mode: 'enforce' });
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await post(server, {
      path: '/webhooks/twilio/main-menu',
      params: { MessageSid: 'SM-APP-REJECT', From: 'whatsapp:+5491100002222', Body: 'hola' },
      headers: {
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        'x-twilio-signature': 'invalid-signature',
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body, 'Forbidden');
    assert.equal(response.body.includes('<Message>'), false);
  });

  test('el body crudo conserva parámetros repetidos en la app real', async (t) => {
    useEnv(t, { mode: 'enforce' });
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/main-menu';
    const rawBody = 'MessageSid=SM-APP-DUP&Tag=b&Tag=a';
    const collapsed = await post(server, {
      path,
      rawBody,
      headers: {
        'x-twilio-signature': twilio.getExpectedTwilioSignature(
          TOKEN,
          `${BASE}${path}`,
          { MessageSid: 'SM-APP-DUP', Tag: 'a' },
        ),
      },
    });
    assert.equal(collapsed.status, 403);
  });

  test('un body malformado responde 4xx sin 500', async (t) => {
    useEnv(t, { mode: 'enforce' });
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await post(server, {
      path: '/webhooks/twilio/main-menu',
      rawBody: Buffer.from([0xff, 0xfe, 0x00, 0xd8]).toString('binary'),
      contentType: 'application/x-www-form-urlencoded; charset=utf-16',
    });
    assert.ok(response.status >= 400 && response.status < 500);
    assert.equal(response.body.includes('<Message>'), false);
  });

  test('el status sigue exigiendo la URL pública con https, puerto, prefijo y proxy falso', async (t) => {
    useEnv(t, { mode: 'off', base: 'https://bot.example:8443', prefix: '/tea' });
    const calls = [];
    const original = monitoringService.recordDeliveryStatus;
    monitoringService.recordDeliveryStatus = async (body) => {
      calls.push(body);
    };
    t.after(() => {
      monitoringService.recordDeliveryStatus = original;
    });
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1/status';
    const params = {
      MessageSid: 'SM-APP-STATUS',
      MessageStatus: 'delivered',
      ErrorCode: '',
      ErrorMessage: '',
    };
    const publicUrl = `https://bot.example:8443/tea${path}`;
    const spoofed = await post(server, {
      path,
      params,
      headers: {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'evil.example',
        host: 'evil.example',
        'x-twilio-signature': twilio.getExpectedTwilioSignature(
          TOKEN,
          `https://evil.example${path}`,
          params,
        ),
      },
    });
    assert.equal(spoofed.status, 403);
    assert.equal(calls.length, 0);
    const valid = await post(server, {
      path,
      params,
      headers: {
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'evil.example',
        'x-twilio-signature': twilio.getExpectedTwilioSignature(TOKEN, publicUrl, params),
      },
    });
    assert.equal(valid.status, 200);
    assert.equal(calls.length, 1);
    process.env.TWILIO_SIGNATURE_MODE = 'log';
    const missing = await post(server, { path, params });
    assert.equal(missing.status, 403);
    assert.equal(calls.length, 1);
  });

  test('un prefijo ambiguo rechaza el status sin volverlo permisivo', async (t) => {
    useEnv(t, {
      mode: 'off',
      base: 'https://bot.example/tea',
      prefix: '/tea',
    });
    const original = monitoringService.recordDeliveryStatus;
    let calls = 0;
    monitoringService.recordDeliveryStatus = async () => {
      calls += 1;
    };
    t.after(() => {
      monitoringService.recordDeliveryStatus = original;
    });
    const server = await listen(createApp());
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const path = '/webhooks/twilio/flow-1/status';
    const params = { MessageSid: 'SM-APP-AMBIGUOUS', MessageStatus: 'sent' };
    const response = await post(server, {
      path,
      params,
      headers: {
        'x-twilio-signature': twilio.getExpectedTwilioSignature(
          TOKEN,
          `https://bot.example/tea${path}`,
          params,
        ),
      },
    });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  });
});
