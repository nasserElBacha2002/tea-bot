import flowEngine from './flow-engine.service.js';
import sessionService from './session.service.js';
import messagePersistence from './message-persistence.service.js';
import humanHandoffService from './human-handoff.service.js';
import { withInboundUserLock } from '../utils/inbound-user-lock.js';
import { nowMs, roundMs } from '../utils/perf-timer.js';

/**
 * Persistencia + motor + outbound, serializado por userId en este proceso.
 */
export async function processCanonicalTwilioInbound(
  event,
  { perfContext = null, flowSnapshot = null, flowMode = 'published' } = {},
) {
  return withInboundUserLock(event.userId, () =>
    processLockedInbound(event, { perfContext, flowSnapshot, flowMode }),
  );
}

async function processLockedInbound(event, { perfContext, flowSnapshot, flowMode }) {
  let conversationContext = await messagePersistence.safeRun('handleInbound', () =>
    messagePersistence.handleInbound(event),
  );

  if (conversationContext?.skipFlowEngine) {
    return {
      kind: 'human_mode_skip',
      conversation: conversationContext.conversation,
      result: null,
      reply: null,
      shouldSendTwiml: false,
    };
  }

  const existingSession = sessionService.getSession(event.userId, perfContext);
  if (existingSession && existingSession.flowId !== event.flowId) {
    console.warn(
      `[TwilioWebhook] provider=${event.provider} userId=${event.userId} sessionFlow=${existingSession.flowId} requestedFlow=${event.flowId} action=reset_session`,
    );
    await messagePersistence.safeRun('handleRuntimeSessionReset', () =>
      messagePersistence.handleRuntimeSessionReset(event, conversationContext),
    );
    await sessionService.resetSession(event.userId, perfContext);
  }

  const engineStart = nowMs();
  const result = await flowEngine.resolveIncomingMessage({
    userId: event.userId,
    text: event.text,
    flowId: event.flowId,
    flowMode,
    flowSnapshot,
    perfContext,
    conversationContext: conversationContext?.conversation ?? null,
  });
  perfContext?.add?.('engineMs', roundMs(nowMs() - engineStart));

  const isHandoff = humanHandoffService.isEngineHandoffResult(result);

  if (isHandoff) {
    const handoffPersist = await messagePersistence.safeRun('handleHumanHandoff', () =>
      messagePersistence.handleHumanHandoff(conversationContext, result, event),
    );
    return {
      kind: 'human_handoff',
      conversation: conversationContext?.conversation ?? null,
      result,
      reply: handoffPersist?.reply || result.reply,
      shouldSendTwiml: handoffPersist?.shouldSendTwiml !== false,
    };
  }

  await messagePersistence.safeRun('handleOutbound', () =>
    messagePersistence.handleOutbound(conversationContext, result, event),
  );

  return {
    kind: 'bot',
    conversation: conversationContext?.conversation ?? null,
    result,
    reply: result.reply,
    shouldSendTwiml: true,
  };
}
