import { registerLiveClient } from '../src/realtime/conversation-live.broadcaster.js';
import conversationTakeoverService from '../src/services/conversation-takeover.service.js';
import conversationInboxService from '../src/services/conversation-inbox.service.js';
import { resolveAgentIdFromUsername } from '../src/utils/agent-identity.js';
import { closePool } from '../src/db/index.js';

const [conversationId, username, role, clientRequestId, operation = 'takeover'] = process.argv.slice(2);
const events = [];

registerLiveClient({
  readyState: 1,
  send(payload) {
    events.push(JSON.parse(String(payload)));
  },
  on() {},
});

function summarize(event) {
  return {
    type: event.type,
    assignedAgentId: event.data?.conversation?.assignedAgentId ?? null,
    status: event.data?.conversation?.status ?? null,
  };
}

const actor = {
  agentId: resolveAgentIdFromUsername(username),
  username,
  role,
};

let report;
try {
  if (operation === 'reply') {
    const result = await conversationInboxService.sendAgentMessage(
      conversationId,
      'respuesta del propietario',
      actor.agentId,
      { username },
    );
    report = {
      ok: true,
      operation,
      username,
      role,
      agentId: actor.agentId,
      status: result.conversation?.status ?? null,
      events: events.map(summarize),
    };
  } else if (operation === 'return') {
    const result = await conversationInboxService.returnConversationToBot(conversationId, actor);
    report = {
      ok: true,
      operation,
      username,
      role,
      agentId: actor.agentId,
      status: result.conversation?.status ?? null,
      events: events.map(summarize),
    };
  } else {
    const result = await conversationTakeoverService.takeover({
      conversationId,
      actor,
      clientRequestId,
    });
    report = {
      ok: true,
      operation: 'takeover',
      username,
      role,
      agentId: actor.agentId,
      assignedAgentId: result.conversation?.assignedAgentId ?? null,
      status: result.conversation?.status ?? null,
      events: events.map(summarize),
    };
  }
} catch (error) {
  report = {
    ok: false,
    operation,
    username,
    role,
    agentId: actor.agentId,
    code: error?.code || 'ERROR',
    events: events.map(summarize),
  };
} finally {
  process.stdout.write(`RESULT ${JSON.stringify(report)}\n`);
  await closePool();
}
