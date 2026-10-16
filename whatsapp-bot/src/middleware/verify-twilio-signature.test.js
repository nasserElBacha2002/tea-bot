import http from 'http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import twilio from 'twilio';
import { config } from '../config.js';
import twilioWebhookRouter from '../routes/twilio-webhook.routes.js';
import monitoringService from '../monitoring/monitoring.service.js';

const TOKEN = 'test-twilio-auth-token';
const BASE = 'https://bot.example';
const PATH = '/webhooks/twilio/flow-1/status';
const PARAMS = {
  MessageSid: 'SM-status-1',
  MessageStatus: 'delivered',
  ErrorCode: '',
  ErrorMessage: '',
};

function signedHeader(params) {
  return twilio.getExpectedTwilioSignature(TOKEN, `${BASE}${PATH}`, params);
}

function post({ headers, params }) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use('/webhooks/twilio', twilioWebhookRouter);
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({
        port,
        path: PATH,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
        });
      });
      req.on('error', (error) => {
        server.close();
        reject(error);
      });
      req.end(body);
    });
  });
}

test('status callback persiste solo con firma Twilio valida', async (t) => {
  const previousToken = config.twilioAuthToken;
  const previousBase = process.env.APP_BASE_URL;
  const calls = [];
  const original = monitoringService.recordDeliveryStatus;
  config.twilioAuthToken = TOKEN;
  process.env.APP_BASE_URL = BASE;
  monitoringService.recordDeliveryStatus = async (body) => {
    calls.push({ ...body });
  };
  t.after(() => {
    config.twilioAuthToken = previousToken;
    if (previousBase == null) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBase;
    monitoringService.recordDeliveryStatus = original;
  });

  const valid = await post({
    params: PARAMS,
    headers: { 'x-twilio-signature': signedHeader(PARAMS) },
  });
  assert.equal(valid.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].MessageSid, 'SM-status-1');
  assert.equal(calls[0].MessageStatus, 'delivered');

  const invalid = await post({
    params: PARAMS,
    headers: { 'x-twilio-signature': 'not-a-valid-signature' },
  });
  assert.equal(invalid.status, 403);
  assert.equal(invalid.body, 'Forbidden');
  assert.equal(calls.length, 1);

  const missing = await post({ params: PARAMS, headers: {} });
  assert.equal(missing.status, 403);
  assert.equal(calls.length, 1);
  assert.equal(missing.body.includes(TOKEN), false);
});
