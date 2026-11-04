import flowEngine from './flow-engine.service.js';
import sessionService from './session.service.js';
import messagePersistence from './message-persistence.service.js';
import humanHandoffService from './human-handoff.service.js';
import conversationReentryService from './conversation-reentry.service.js';
import conversationService from './conversation.service.js';
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
  const conversationContext = await messagePersistence.safeRun(
    'handleInbound',
    () => messagePersistence.handleInbound(event),
    { required: true },
  );

  if (conversationContext?.skipFlowEngine) {
    if (conversationContext.reentryReply) {
      return {
        kind: 'reentry',
        conversation: conversationContext.conversation,
        result: null,
        reply: conversationContext.reentryReply,
        shouldSendTwiml: true,
      };
    }
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

  const freshConversation = await messagePersistence.safeRun(
    'reloadBeforeOutbound',
    () => conversationService.reloadConversation(conversationContext?.conversation),
    { required: true },
  );
  if (freshConversation?.reentryJson) {
    const superseded = await conversationReentryService.consumeInbound(
      freshConversation,
      event.text || '',
    );
    if (superseded?.action === 'human_skip') {
      return {
        kind: 'human_mode_skip',
        conversation: superseded.conversation,
        result: null,
        reply: null,
        shouldSendTwiml: false,
      };
    }
    if (superseded?.action === 'present_entry' || superseded?.action === 'legacy_cleared') {
      await conversationReentryService.resetRuntime(superseded.conversation);
      const presented = await flowEngine.resolveIncomingMessage({
        userId: event.userId,
        text: event.text,
        flowId: event.flowId,
        flowMode,
        flowSnapshot,
        perfContext,
        conversationContext: superseded.conversation,
      });
      await messagePersistence.safeRun(
        'handleOutbound',
        () => messagePersistence.handleOutbound(
          { conversation: superseded.conversation, dbSession: null },
          presented,
          event,
        ),
        { required: true },
      );
      return {
        kind: 'bot',
        conversation: superseded.conversation,
        result: presented,
        reply: presented.reply,
        shouldSendTwiml: true,
      };
    }
    if (superseded?.reply) {
      const finished = await messagePersistence.finishReentry(superseded);
      if (!finished?.reentryReply) {
        throw new Error('reentry outbound was not persisted');
      }
      if (superseded.action !== 'present_node') {
        await conversationReentryService.resetRuntime(superseded.conversation);
      }
      return {
        kind: 'reentry',
        conversation: finished.conversation || superseded.conversation,
        result: null,
        reply: finished.reentryReply,
        shouldSendTwiml: true,
      };
    }
  }

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
