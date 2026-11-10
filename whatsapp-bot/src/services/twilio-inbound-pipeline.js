import flowEngine from './flow-engine.service.js';
import sessionService from './session.service.js';
import messagePersistence from './message-persistence.service.js';
import humanHandoffService from './human-handoff.service.js';
import conversationReentryService from './conversation-reentry.service.js';
import conversationService from './conversation.service.js';
import { withInboundUserLock } from '../utils/inbound-user-lock.js';
import { withInboundLease } from '../monitoring/inbound-lease.js';
import { twilioTurnOutboundId } from '../monitoring/webhook-events.service.js';
import { nowMs, roundMs } from '../utils/perf-timer.js';

const PERSISTED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function humanSkip(conversation) {
  return {
    kind: 'human_mode_skip',
    conversation: conversation || null,
    result: null,
    reply: null,
    shouldSendTwiml: false,
  };
}

function indeterminate(conversation, reason) {
  return {
    kind: 'reply_indeterminate',
    conversation: conversation || null,
    result: null,
    reply: null,
    shouldSendTwiml: false,
    reason: reason || 'indeterminate',
  };
}

function classifyOutbound(outbound, conversation) {
  if (outbound?.decision === 'SUPPRESS') return humanSkip(outbound.conversation || conversation);
  if (outbound?.decision === 'INDETERMINATE') {
    return indeterminate(outbound.conversation || conversation, outbound.reason);
  }
  return null;
}

/**
 * Persistencia + motor + outbound, serializado por userId en este proceso.
 * La autorización de la respuesta automática y su persistencia ocurren en la
 * misma transacción. TwiML se arma después de ese commit.
 */
export async function processCanonicalTwilioInbound(
  event,
  { perfContext = null, flowSnapshot = null, flowMode = 'published', lease = null } = {},
) {
  try {
    return await withInboundLease(lease, () =>
      withInboundUserLock(event.userId, () =>
        processLockedInbound(event, { perfContext, flowSnapshot, flowMode }),
      ));
  } catch (error) {
    if (error?.code === 'INBOUND_LEASE_LOST') {
      try {
        await sessionService.resetSession(event.userId);
      } catch {
        /* la sesión en memoria no debe impedir que el dueño nuevo cierre el turno */
      }
    }
    throw error;
  }
}

async function processLockedInbound(event, { perfContext, flowSnapshot, flowMode }) {
  const replay = await messagePersistence.safeRun(
    'replayCommittedTurn',
    () => messagePersistence.replayCommittedTurn(event),
    { required: true },
  );
  if (replay) return replay;

  const conversationContext = await messagePersistence.safeRun(
    'handleInbound',
    () => messagePersistence.handleInbound(event),
    { required: true },
  );

  const statusVersionAtStart = conversationContext?.conversation?.statusVersion ?? null;

  if (conversationContext?.decision === 'INDETERMINATE') {
    return indeterminate(conversationContext.conversation, conversationContext.reason);
  }

  if (conversationContext?.skipFlowEngine) {
    if (conversationContext.reentryReply) {
      return {
        kind: 'reentry',
        conversation: conversationContext.conversation,
        result: null,
        reply: conversationContext.reentryReply,
        shouldSendTwiml: true,
        replyAuthorized: true,
      };
    }
    return humanSkip(conversationContext.conversation);
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
      { providerMessageId: event.messageId || null },
    );
    if (superseded?.action === 'human_skip') {
      return humanSkip(superseded.conversation);
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
      const outbound = await messagePersistence.safeRun(
        'handleOutbound',
        () => messagePersistence.handleOutbound(
          { conversation: superseded.conversation, dbSession: null },
          presented,
          event,
          statusVersionAtStart,
        ),
        { required: true },
      );
      const blocked = classifyOutbound(outbound, superseded.conversation);
      if (blocked) return blocked;
      return {
        kind: 'bot',
        conversation: superseded.conversation,
        result: presented,
        reply: presented.reply,
        shouldSendTwiml: true,
        replyAuthorized: true,
      };
    }
    if (superseded?.reply) {
      const finished = await messagePersistence.finishReentry(
        superseded,
        statusVersionAtStart,
        { providerMessageId: twilioTurnOutboundId(event.messageId) },
      );
      if (finished?.decision === 'INDETERMINATE') {
        return indeterminate(finished.conversation || superseded.conversation, finished.reason);
      }
      if (finished?.suppressedByTakeover || finished?.decision === 'SUPPRESS') {
        return humanSkip(finished.conversation || superseded.conversation);
      }
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
        replyAuthorized: true,
      };
    }
  }

  if (isHandoff) {
    const handoffPersist = await messagePersistence.safeRun(
      'handleHumanHandoff',
      () => messagePersistence.handleHumanHandoff(conversationContext, result, event),
      { required: true },
    );
    if (handoffPersist?.shouldSendTwiml === false) {
      return humanSkip(conversationContext?.conversation);
    }
    return {
      kind: 'human_handoff',
      conversation: conversationContext?.conversation ?? null,
      result,
      reply: handoffPersist?.reply || result.reply,
      shouldSendTwiml: handoffPersist?.shouldSendTwiml !== false,
      replyAuthorized: Boolean(handoffPersist?.shouldSendTwiml),
    };
  }

  const outbound = await messagePersistence.safeRun(
    'handleOutbound',
    () => messagePersistence.handleOutbound(
      conversationContext,
      result,
      event,
      statusVersionAtStart,
    ),
    { required: true },
  );
  const blocked = classifyOutbound(outbound, conversationContext?.conversation);
  if (blocked) return blocked;

  return {
    kind: 'bot',
    conversation: conversationContext?.conversation ?? null,
    result,
    reply: result.reply,
    shouldSendTwiml: true,
    replyAuthorized: conversationContext?.conversation?.id
      ? PERSISTED_ID.test(String(conversationContext.conversation.id))
        ? outbound?.decision === 'ALLOW'
        : true
      : true,
  };
}
