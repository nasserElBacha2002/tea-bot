#!/usr/bin/env node
/**
 * Envía un mensaje simulado al inbox vía API dev (sin WhatsApp).
 * Requiere servidor local y credenciales admin en .env.
 *
 * Uso:
 *   npm run conversations:simulate-message -- "Hola"
 *   npm run conversations:simulate-message -- "Quiero hablar con una persona"
 */
import dotenv from 'dotenv';

dotenv.config();

const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const message = process.argv[2] || 'Hola';
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_PLAIN;

async function main() {
  if (!password) {
    console.error('Definí ADMIN_PASSWORD o ADMIN_PASSWORD_PLAIN en .env');
    process.exit(1);
  }

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginJson = await loginRes.json();
  if (!loginRes.ok) {
    console.error('Login falló:', loginJson);
    process.exit(1);
  }

  const cookie = loginRes.headers.get('set-cookie');
  const inboundRes = await fetch(`${base}/api/dev/conversations/inbound-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie?.split(';')[0] ?? '',
    },
    body: JSON.stringify({
      message,
      name: 'Simulación Local',
      phone: 'simulator-local-001',
      flowId: 'main-menu',
    }),
  });
  const body = await inboundRes.json();
  console.log(JSON.stringify(body, null, 2));
  process.exit(inboundRes.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
