import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import {
  parseCookies,
  verifySignedSessionToken,
} from '../services/admin-auth.service.js';
import { registerLiveClient } from './conversation-live.broadcaster.js';

const DEV_LOG = process.env.NODE_ENV !== 'production';
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 45_000;
const LIVE_PATH = '/api/conversations/live';

function devLog(...args) {
  if (DEV_LOG) console.log('[conversations-live]', ...args);
}

function verifyUpgradeRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.tea_session;
  if (!token) return null;
  return verifySignedSessionToken(token, config.sessionSecret);
}

function handleAppMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'pong') {
    ws.lastAppPongAt = Date.now();
    return;
  }

  if (msg.type === 'ping') {
    ws.lastAppPongAt = Date.now();
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'pong', occurredAt: new Date().toISOString() }));
    }
  }
}

/**
 * Varias pestañas del mismo operador pueden estar conectadas.
 * Cerrar la anterior provoca un ciclo: el cliente reemplazado reconecta y desplaza a la nueva.
 *
 * @param {import('http').Server} httpServer
 */
export function attachConversationLiveWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  const pingTimer = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        devLog('protocol ping timeout', ws.connectionId, ws.username);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();

      const lastPong = ws.lastAppPongAt || ws.connectedAt || now;
      if (now - lastPong > PONG_TIMEOUT_MS) {
        devLog('app heartbeat timeout', ws.connectionId, ws.username);
        ws.terminate();
        continue;
      }

      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'ping', occurredAt: new Date().toISOString() }));
      }
    }
    if (DEV_LOG) {
      devLog('active connections', wss.clients.size);
    }
  }, PING_INTERVAL_MS);

  wss.on('close', () => clearInterval(pingTimer));

  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url?.split('?')[0] ?? '';
    if (url !== LIVE_PATH) {
      return;
    }

    const session = verifyUpgradeRequest(request);
    if (!session) {
      devLog('upgrade rejected (unauthorized)');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const connectionId = randomUUID().slice(0, 8);
      ws.connectionId = connectionId;
      ws.username = session.username;
      ws.isAlive = true;
      ws.connectedAt = Date.now();
      ws.lastAppPongAt = ws.connectedAt;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (raw) => handleAppMessage(ws, raw));

      registerLiveClient(ws);

      wss.emit('connection', ws, request);
      ws.send(
        JSON.stringify({
          type: 'connected',
          occurredAt: new Date().toISOString(),
          data: { username: session.username },
        }),
      );
      devLog('connected', { connectionId, username: session.username, active: wss.clients.size });
    });
  });

  wss.on('connection', (ws) => {
    ws.on('close', () => {
      devLog('disconnected', {
        connectionId: ws.connectionId,
        username: ws.username,
        active: wss.clients.size,
      });
    });
  });

  devLog('websocket attached at', LIVE_PATH);
  return wss;
}
