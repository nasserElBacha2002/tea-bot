import { CONVERSATION_LIVE_EVENT_TYPES } from './conversation-live.events.js';

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

const DEV_LOG = process.env.NODE_ENV !== 'production';

function devLog(...args) {
  if (DEV_LOG) console.log('[conversations-live]', ...args);
}

/**
 * @param {import('ws').WebSocket} ws
 */
export function registerLiveClient(ws) {
  clients.add(ws);
  devLog('client registered', clients.size);
  ws.on('close', () => {
    clients.delete(ws);
    devLog('client removed', clients.size);
  });
}

export function getLiveClientCount() {
  return clients.size;
}

/**
 * @param {object} event
 */
export function publishConversationLiveEvent(event) {
  if (!event?.type || !event?.conversationId) return;
  const payload = JSON.stringify({
    ...event,
    occurredAt: event.occurredAt || new Date().toISOString(),
  });
  let sent = 0;
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(payload);
      sent += 1;
    }
  }
  if (DEV_LOG && sent > 0) {
    devLog('broadcast', event.type, event.conversationId, `clients=${sent}`);
  }
}

export function publishConversationCreated(conversationId, data = {}) {
  publishConversationLiveEvent({
    type: CONVERSATION_LIVE_EVENT_TYPES.CREATED,
    conversationId,
    data,
  });
}

export function publishConversationUpdated(conversationId, data = {}) {
  publishConversationLiveEvent({
    type: CONVERSATION_LIVE_EVENT_TYPES.UPDATED,
    conversationId,
    data,
  });
}

export function publishConversationMessageCreated(conversationId, data = {}) {
  publishConversationLiveEvent({
    type: CONVERSATION_LIVE_EVENT_TYPES.MESSAGE_CREATED,
    conversationId,
    data,
  });
}

export function publishConversationAssigned(conversationId, data = {}) {
  publishConversationLiveEvent({
    type: CONVERSATION_LIVE_EVENT_TYPES.ASSIGNED,
    conversationId,
    data,
  });
}

export function publishConversationClosed(conversationId, data = {}) {
  publishConversationLiveEvent({
    type: CONVERSATION_LIVE_EVENT_TYPES.CLOSED,
    conversationId,
    data,
  });
}

export function publishConversationReturnedToBot(conversationId, data = {}) {
  publishConversationLiveEvent({
    type: CONVERSATION_LIVE_EVENT_TYPES.RETURNED_TO_BOT,
    conversationId,
    data,
  });
}

export function resetLiveClientsForTests() {
  clients.clear();
}
