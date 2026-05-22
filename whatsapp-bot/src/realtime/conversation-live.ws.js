import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import {
  parseCookies,
  verifySignedSessionToken,
} from '../services/admin-auth.service.js';
import { registerLiveClient } from './conversation-live.broadcaster.js';

const DEV_LOG = process.env.NODE_ENV !== 'production';
const PING_INTERVAL_MS = 30_000;
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

/**
 * @param {import('http').Server} httpServer
 */
export function attachConversationLiveWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
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
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
      registerLiveClient(ws);
      wss.emit('connection', ws, request);
      ws.send(
        JSON.stringify({
          type: 'connected',
          occurredAt: new Date().toISOString(),
          data: { username: session.username },
        }),
      );
      devLog('connected', session.username);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('close', () => devLog('disconnected'));
  });

  devLog('websocket attached at', LIVE_PATH);
  return wss;
}
