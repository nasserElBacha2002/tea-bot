import { spawnSync } from 'node:child_process';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assessTwilioSignatureReadiness,
  planTwilioPublicUrl,
  twilioSignatureStartupDecision,
} from '../config.js';
import { resolveInboundSignatureUrl } from './verify-twilio-signature.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PATH = '/webhooks/twilio/flow-1';

function signedUrl(env, originalUrl = PATH) {
  return resolveInboundSignatureUrl({ originalUrl, url: originalUrl }, env);
}

describe('TB-005 contrato de URL pública', { concurrency: 1 }, () => {
  test('1. sin prefijo usa el origen y la ruta de Express', () => {
    const target = signedUrl({ APP_BASE_URL: 'https://bot.example' });
    assert.equal(target.ok, true);
    assert.equal(target.url, `https://bot.example${PATH}`);
    assert.equal(planTwilioPublicUrl({ APP_BASE_URL: 'https://bot.example' }).prefixSource, 'none');
  });

  test('2. prefijo eliminado por Nginx se agrega una sola vez', () => {
    const target = signedUrl({
      APP_BASE_URL: 'https://bot.example',
      TWILIO_PUBLIC_PATH_PREFIX: '/tea',
    });
    assert.equal(target.url, `https://bot.example/tea${PATH}`);
  });

  test('3. prefijo conservado por Nginx no se vuelve a agregar', () => {
    const received = `/tea${PATH}`;
    const target = signedUrl({ APP_BASE_URL: 'https://bot.example' }, received);
    assert.equal(target.url, `https://bot.example${received}`);
    assert.equal(target.url.includes('/tea/tea/'), false);
  });

  test('4. el prefijo incluido en APP_BASE_URL se usa y el request no lo repite', () => {
    const target = signedUrl({ APP_BASE_URL: 'https://bot.example/tea' });
    assert.equal(target.url, `https://bot.example/tea${PATH}`);
    assert.equal(planTwilioPublicUrl({ APP_BASE_URL: 'https://bot.example/tea' }).prefixSource, 'base');
  });

  test('5. el prefijo configurado dos veces es ambiguo', () => {
    const env = {
      APP_BASE_URL: 'https://bot.example/tea',
      TWILIO_PUBLIC_PATH_PREFIX: '/tea',
    };
    const plan = planTwilioPublicUrl(env);
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'public_prefix_ambiguous');
    const target = signedUrl(env);
    assert.equal(target.ok, false);
    assert.equal(target.url, null);
  });

  test('6. un segmento parecido no se trata como prefijo', () => {
    const target = signedUrl(
      { APP_BASE_URL: 'https://bot.example', TWILIO_PUBLIC_PATH_PREFIX: '/web' },
      '/webhooks/twilio/flow-1',
    );
    assert.equal(target.url, 'https://bot.example/web/webhooks/twilio/flow-1');
  });

  test('7. el query string no se recodifica', () => {
    const originalUrl = `${PATH}?b=2&a=1&q=hello%20world`;
    const target = signedUrl({ APP_BASE_URL: 'https://bot.example' }, originalUrl);
    assert.equal(target.url, `https://bot.example${originalUrl}`);
    assert.equal(target.safe.pathname, PATH);
    assert.equal(JSON.stringify(target.safe).includes('hello'), false);
  });

  test('8. https conserva el puerto explícito', () => {
    const target = signedUrl({ APP_BASE_URL: 'https://bot.example:8443' });
    assert.equal(target.url, `https://bot.example:8443${PATH}`);
    assert.equal(target.safe.protocol, 'https');
    assert.equal(target.safe.host, 'bot.example:8443');
  });

  test('9. los headers forwarded no entran en la URL', () => {
    const target = resolveInboundSignatureUrl({
      originalUrl: PATH,
      get(name) {
        const headers = {
          'x-forwarded-proto': 'http',
          'x-forwarded-host': 'evil.example',
          host: 'evil.example',
        };
        return headers[String(name).toLowerCase()] || '';
      },
    }, { APP_BASE_URL: 'https://bot.example' });
    assert.equal(target.url, `https://bot.example${PATH}`);
  });

  test('10. una URL ausente o inválida no se arma', () => {
    assert.equal(signedUrl({}).reason, 'public_url_unconfigured');
    assert.equal(signedUrl({ APP_BASE_URL: 'notaurl' }).reason, 'public_url_invalid');
    assert.equal(signedUrl({ APP_BASE_URL: 'ftp://bot.example' }).reason, 'public_url_invalid');
    assert.equal(
      signedUrl({ APP_BASE_URL: 'https://user:secret@bot.example' }).reason,
      'public_url_invalid',
    );
    assert.equal(
      planTwilioPublicUrl({
        APP_BASE_URL: 'https://bot.example',
        TWILIO_PUBLIC_PATH_PREFIX: '/../tea',
      }).reason,
      'public_path_prefix_invalid',
    );
  });
});

describe('TB-005 preflight de firma', { concurrency: 1 }, () => {
  test('off no queda listo ni activado aunque la URL y el token existan', () => {
    const report = assessTwilioSignatureReadiness({
      APP_BASE_URL: 'https://bot.example',
    }, 'present-token');
    assert.equal(report.mode, 'off');
    assert.equal(report.ready, false);
    assert.equal(report.activated, false);
    assert.equal(report.secure, false);
    assert.equal(report.configurationState, 'insecure');
    assert.equal(report.logReady, true);
    assert.equal(report.enforceConfigurable, true);
    assert.equal(report.enforceReady, false);
    assert.equal(report.productionUrlVerified, false);
    assert.equal(twilioSignatureStartupDecision(report).allowBoot, true);
    assert.equal(JSON.stringify(report).includes('present-token'), false);
  });

  test('log sin token no arranca y no se describe como inocuo', () => {
    const report = assessTwilioSignatureReadiness({
      TWILIO_SIGNATURE_MODE: 'log',
      APP_BASE_URL: 'https://bot.example',
    }, '');
    assert.equal(report.ready, false);
    assert.equal(report.activated, false);
    assert.equal(report.logReady, false);
    assert.equal(report.logDisruptive, true);
    assert.equal(report.startup, 'refuse');
    assert.equal(report.startupBlocking.includes('missing_auth_token'), true);
    assert.equal(twilioSignatureStartupDecision(report).allowBoot, false);
  });

  test('log completo queda observando y enforce sigue sin aprobarse', () => {
    const report = assessTwilioSignatureReadiness({
      TWILIO_SIGNATURE_MODE: 'log',
      APP_BASE_URL: 'https://bot.example',
    }, 'present-token');
    assert.equal(report.ready, true);
    assert.equal(report.activated, true);
    assert.equal(report.configurationState, 'observing');
    assert.equal(report.secure, false);
    assert.equal(report.enforceReady, false);
    assert.equal(report.authTokenConfigured, true);
    assert.equal(JSON.stringify(report).includes('present-token'), false);
  });

  test('enforce ambiguo se rechaza antes de aceptar tráfico', () => {
    const report = assessTwilioSignatureReadiness({
      TWILIO_SIGNATURE_MODE: 'enforce',
      APP_BASE_URL: 'https://bot.example/tea',
      TWILIO_PUBLIC_PATH_PREFIX: '/tea',
    }, 'present-token');
    assert.equal(report.enforceConfigurable, false);
    assert.equal(report.enforceReady, false);
    assert.equal(report.startup, 'refuse');
    assert.equal(report.startupBlocking.includes('public_prefix_ambiguous'), true);
    assert.equal(report.publicPrefixValid, false);
  });

  test('el comando de preflight no imprime el token y off no sale en cero', () => {
    const result = spawnSync(process.execPath, ['scripts/twilio-signature-preflight.js'], {
      cwd: root,
      env: {
        ...process.env,
        TWILIO_SIGNATURE_MODE: 'off',
        TWILIO_AUTH_TOKEN: 'super-secret-token-value',
        APP_BASE_URL: 'https://bot.example',
        TWILIO_PUBLIC_PATH_PREFIX: '',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.equal(`${result.stdout}${result.stderr}`.includes('super-secret-token-value'), false);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, 'off');
    assert.equal(report.ready, false);
    assert.equal(report.logReady, true);
    assert.equal(report.enforceReady, false);
  });

  test('validateConfig no arranca log sin token y no lo degrada a off', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { validateConfig } from './src/config.js';
      validateConfig();
      console.log('BOOTED');
    `], {
      cwd: root,
      env: {
        ...process.env,
        TWILIO_SIGNATURE_MODE: 'log',
        TWILIO_AUTH_TOKEN: '',
        APP_BASE_URL: '',
        TWILIO_PUBLIC_PATH_PREFIX: '',
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes('BOOTED'), false);
    assert.equal(`${result.stdout}${result.stderr}`.includes('missing_auth_token'), true);
    assert.equal(`${result.stdout}${result.stderr}`.includes('No se degrada a off'), true);
  });
});
