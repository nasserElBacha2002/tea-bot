import conversationRepository from '../repositories/conversation.repository.js';
import conversationSessionRepository from '../repositories/conversation-session.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import flowDbRepository from '../repositories/flow-db.repository.js';
import humanHandoffService from './human-handoff.service.js';
import sessionService from './session.service.js';
import flowLoader from '../utils/flow-loader.js';
import {
  isConversationDbEnabled,
  query,
  validateSqlServerEnv,
  withTransaction,
} from '../db/index.js';
import { fenceInboundLease } from '../monitoring/inbound-lease.js';
import { notifyConversationUpdated } from '../realtime/conversation-live.notify.js';
import { mapHumanHandoffPublic } from '../utils/conversation-inbox.mapper.js';
import { isConversationInHumanMode, DEFAULT_HANDOFF_MESSAGE } from '../utils/handoff-detection.js';
import {
  MAX_INVALID_REENTRY_ATTEMPTS,
  REENTRY_PROMPT,
  buildReentrySnapshot,
  classifyReentryInput,
  decideResumeCompatibility,
  hasFlowProgressAfterReturn,
  normalizeFlowVersion,
  noteReentryColumn,
  resolveReentryPolicy,
} from '../utils/conversation-reentry-policy.js';

export { REENTRY_PROMPT, resolveReentryPolicy };

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function logReentry(event, payload) {
  console.log(JSON.stringify({ event, ...payload }));
}

function parseFlowDocument(snapshotJson) {
  if (!snapshotJson) return null;
  if (typeof snapshotJson === 'string') {
    try {
      return JSON.parse(snapshotJson);
    } catch {
      return null;
    }
  }
  return typeof snapshotJson === 'object' ? snapshotJson : null;
}

/**
 * Marca si la columna existe. Sin ella el cierre no escribe reentry_json.
 */
export async function probeReentryColumn() {
  const { rows } = await query(
    `SELECT COL_LENGTH('dbo.conversations', 'reentry_json') AS column_length`,
  );
  const length = rows[0]?.column_length;
  const present = length != null && Number(length) !== 0;
  noteReentryColumn(present);
  if (!present) {
    console.error(
      '[Reentry] Falta dbo.conversations.reentry_json. Aplicá migrations/008_conversation_reentry.sql antes de usar REENTRY_POLICY=prompt. El cierre humano deja el cursor en null y no ofrece la elección.',
    );
  }
  return present;
}

/**
 * Reentrada persistida después de cerrar una atención humana.
 * El primer texto libre no entra al matcher del menú.
 */
export class ConversationReentryService {
  /**
   * @param {{
   *   conversationRepo?: typeof conversationRepository,
   *   sessionRepo?: typeof conversationSessionRepository,
   *   handoffService?: typeof humanHandoffService,
   *   runtimeSession?: typeof sessionService,
   *   flowLoader?: { getFlow: (flowId: string) => Promise<object> },
   *   loadHistoricalFlow?: (flowId: string, version: string) => Promise<object | null>,
   *   runTransaction?: typeof withTransaction,
   *   policy?: () => 'prompt' | 'legacy' | 'degraded',
   *   queriesEnabled?: () => boolean,
   * }} [deps]
   */
  constructor(deps = {}) {
    this.conversationRepo = deps.conversationRepo || conversationRepository;
    this.sessionRepo = deps.sessionRepo || conversationSessionRepository;
    this.messageRepo = deps.messageRepo || conversationMessageRepository;
    this.handoffService = deps.handoffService || humanHandoffService;
    this.runtimeSession = deps.runtimeSession || sessionService;
    this.flowLoader = deps.flowLoader || flowLoader;
    this.loadHistoricalFlow = deps.loadHistoricalFlow || ((flowId, version) => this.defaultLoadHistoricalFlow(flowId, version));
    this.runTransaction = deps.runTransaction || withTransaction;
    this.policy = deps.policy || resolveReentryPolicy;
    this.queriesEnabled = deps.queriesEnabled || (() => (
      isConversationDbEnabled() && validateSqlServerEnv().ok
    ));
  }

  async defaultLoadHistoricalFlow(flowId, version) {
    try {
      const row = await flowDbRepository.getPublishedSnapshotByLabel(flowId, String(version));
      return parseFlowDocument(row?.snapshotJson);
    } catch (error) {
      logReentry('reentry_historical_flow_unavailable', {
        flowId,
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async resetRuntime(conversation) {
    if (!conversation?.externalUserId) return;
    try {
      await this.runtimeSession.resetSession(conversation.externalUserId);
    } catch (error) {
      logReentry('reentry_runtime_reset_failed', {
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Restaura solo contra el flujo publicado.
   * Una versión distinta se migra si el contrato del nodo no cambió.
   * Si no se puede verificar, el caller reinicia por el entry.
   * @param {object | null | undefined} reentry
   */
  async resolveResumeTarget(reentry) {
    const nodeKey = String(reentry?.resumeNodeKey || '').trim();
    if (!nodeKey) return { decision: 'restart', reason: 'resume_unavailable' };
    const flowId = reentry.flowId || 'main-menu';
    let flow;
    try {
      flow = await this.flowLoader.getFlow(flowId);
    } catch (error) {
      logReentry('reentry_resume_flow_unavailable', {
        flowId,
        nodeKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return { decision: 'restart', reason: 'published_unavailable' };
    }
    const publishedNode = flow?.nodes?.find((item) => item.id === nodeKey) || null;
    const publishedVersion = flow?.version || null;
    const versionsDiffer = normalizeFlowVersion(reentry.flowVersion) !== normalizeFlowVersion(publishedVersion);
    let historicalNode = null;
    let historicalLoaded = false;
    if (versionsDiffer && normalizeFlowVersion(reentry.flowVersion)) {
      const historical = await this.loadHistoricalFlow(flowId, reentry.flowVersion);
      historicalLoaded = Boolean(historical);
      historicalNode = historical?.nodes?.find((item) => item.id === nodeKey) || null;
    }
    const compatibility = decideResumeCompatibility({
      snapshotVersion: reentry.flowVersion,
      publishedVersion,
      publishedNode,
      historicalNode,
      historicalLoaded,
    });
    if (compatibility.decision === 'restart') return compatibility;
    return {
      decision: compatibility.decision,
      reason: compatibility.reason,
      nodeKey,
      message: publishedNode.message,
      flowId: flow.id || flowId,
      flowVersion: publishedVersion,
    };
  }

  /**
   * @param {object} conversation
   * @param {string} text
   */
  async consumeInbound(conversation, text, options = {}) {
    if (!conversation?.id) return null;
    if (!conversation.reentryJson) {
      if (this.policy() !== 'prompt') return null;
      const parked = await this.legacyParkedState(conversation.id);
      if (!parked?.parked) return null;
      return this.advance(conversation, text, options);
    }
    if (this.policy() === 'legacy') {
      return this.rollbackPending(conversation);
    }
    return this.advance(conversation, text, options);
  }

  /**
   * Cierres anteriores al snapshot: no hay reentry_json, pero el system de
   * devolución sigue siendo el último paso real. El fallback no cuenta.
   * @returns {Promise<{ parked: boolean, returnedAt: Date | string } | null>}
   */
  async legacyParkedState(conversationId, transaction) {
    if (this.policy() !== 'prompt' || !this.queriesEnabled()) return null;
    if (!CONVERSATION_ID.test(String(conversationId || ''))) return null;
    const returned = await this.messageRepo.findLatestReturnToBot(conversationId, { transaction });
    if (!returned?.createdAt) return null;
    const outbound = await this.messageRepo.listOutboundSince(
      conversationId,
      returned.createdAt,
      { transaction },
    );
    return {
      parked: !hasFlowProgressAfterReturn(outbound),
      returnedAt: returned.createdAt,
    };
  }

  async legacySnapshot(locked, transaction) {
    const parked = await this.legacyParkedState(locked.id, transaction);
    if (!parked?.parked) return null;
    const session = await this.sessionRepo.findLatestStartedAtOrBefore(
      locked.id,
      parked.returnedAt,
      { transaction },
    );
    return {
      ...buildReentrySnapshot({
        conversation: locked,
        openSession: session,
        capturedAt: new Date().toISOString(),
      }),
      source: 'legacy_return',
    };
  }

  async rollbackPending(conversation) {
    const txResult = await this.runTransaction(async (transaction) => {
      await fenceInboundLease(transaction);
      const locked = await this.conversationRepo.findByIdForUpdate(conversation.id, { transaction });
      if (!locked) return { action: 'delegate', conversation };
      if (isConversationInHumanMode(locked)) {
        return { action: 'human_skip', conversation: locked };
      }
      if (!locked.reentryJson) return { action: 'delegate', conversation: locked };

      await this.sessionRepo.endAllOpenForConversation(locked.id, new Date(), { transaction });
      const updated = await this.conversationRepo.updateConversation(
        locked.id,
        {
          reentryJson: null,
          currentNodeKey: null,
          status: 'bot',
          assignedAgentId: null,
        },
        { transaction },
      );
      return { action: 'legacy_cleared', conversation: updated, reason: 'policy_legacy' };
    });

    if (txResult?.action === 'legacy_cleared') {
      await this.resetRuntime(txResult.conversation);
      logReentry('reentry_legacy_rollback', { conversationId: conversation.id });
    }
    return txResult;
  }

  async advance(conversation, text, options = {}) {
    const txResult = await this.runTransaction(async (transaction) => {
      await fenceInboundLease(transaction);
      const replayed = await this.replayTurnEffect(options.providerMessageId, transaction);
      if (replayed) return replayed;
      const locked = await this.conversationRepo.findByIdForUpdate(conversation.id, { transaction });
      if (!locked) return { action: 'delegate', conversation };
      if (isConversationInHumanMode(locked)) {
        return { action: 'human_skip', conversation: locked };
      }

      let current = locked;
      let armedLegacy = false;
      if (!current.reentryJson) {
        const snapshot = await this.legacySnapshot(current, transaction);
        if (!snapshot) return { action: 'delegate', conversation: current };
        await this.sessionRepo.endAllOpenForConversation(current.id, new Date(), { transaction });
        current = { ...current, reentryJson: snapshot, currentNodeKey: null };
        armedLegacy = true;
      }

      const reentry = current.reentryJson;
      if (!reentry || (reentry.status !== 'pending' && reentry.status !== 'awaiting_choice')) {
        return { action: 'delegate', conversation: current };
      }

      const decision = classifyReentryInput(text, reentry.status);
      let applied;
      if (decision === 'human') applied = await this.applyHuman(current, transaction);
      else if (decision === 'fresh') applied = await this.applyFresh(current, transaction, 'fresh');
      else if (decision === 'continue') applied = await this.applyContinue(current, transaction);
      else if (decision === 'present') applied = await this.applyPrompt(current, transaction, text);
      else applied = await this.applyReprompt(current, transaction);
      if (armedLegacy && applied && !applied.reason) applied.reason = 'legacy_return';
      await this.rememberTurnEffect(options.providerMessageId, applied, transaction);
      return applied;
    });

    if (txResult?.replayed) return txResult;

    if (txResult?.action === 'handoff') {
      notifyConversationUpdated(txResult.conversation, {
        humanHandoff: mapHumanHandoffPublic(txResult.handoff),
      });
      await this.resetRuntime(txResult.conversation);
    } else if (txResult?.action === 'present_node') {
      await this.restoreRuntime(txResult);
    } else if (txResult?.action === 'present_entry') {
      await this.resetRuntime(txResult.conversation);
    }

    if (txResult?.action && txResult.action !== 'delegate' && txResult.action !== 'human_skip') {
      logReentry('reentry_inbound', {
        conversationId: conversation.id,
        action: txResult.action,
        reason: txResult.reason || null,
        nodeKey: txResult.nodeKey || null,
      });
    }
    return txResult;
  }

  async replayTurnEffect(providerMessageId, transaction) {
    if (!providerMessageId || typeof this.messageRepo.findByProviderMessageId !== 'function') return null;
    const message = await this.messageRepo.findByProviderMessageId('twilio', providerMessageId, { transaction });
    const effect = message?.metadataJson?.turnEffect;
    if (!effect || effect.messageId !== providerMessageId || !effect.action || effect.action === 'delegate') {
      return null;
    }
    const conversationId = effect.conversationId || message.conversationId;
    const conversation = typeof this.conversationRepo.findById === 'function'
      ? await this.conversationRepo.findById(conversationId, { transaction })
      : null;
    return {
      action: effect.action,
      reply: effect.reply || null,
      conversation: conversation || { id: conversationId },
      nodeKey: effect.nodeKey || null,
      reason: effect.reason || 'replayed_effect',
      replayed: true,
    };
  }

  async rememberTurnEffect(providerMessageId, applied, transaction) {
    if (!providerMessageId || !applied?.action || applied.action === 'delegate') return;
    if (typeof this.messageRepo.recordTurnEffect !== 'function') return;
    await this.messageRepo.recordTurnEffect('twilio', providerMessageId, {
      messageId: providerMessageId,
      action: applied.action,
      reply: applied.reply || null,
      nodeKey: applied.nodeKey || null,
      reason: applied.reason || null,
      conversationId: applied.conversation?.id || null,
    }, { transaction });
  }

  async applyPrompt(locked, transaction, text) {
    const next = {
      ...locked.reentryJson,
      status: 'awaiting_choice',
      triggerText: String(text || '').slice(0, 500),
      invalidAttempts: 0,
    };
    const updated = await this.conversationRepo.updateConversation(
      locked.id,
      {
        reentryJson: next,
        currentNodeKey: null,
        status: 'bot',
        assignedAgentId: null,
      },
      { transaction },
    );
    return { action: 'prompt', reply: REENTRY_PROMPT, conversation: updated, nodeKey: null };
  }

  async applyReprompt(locked, transaction) {
    const current = Number(locked.reentryJson?.invalidAttempts) || 0;
    const nextCount = current + 1;
    if (nextCount >= MAX_INVALID_REENTRY_ATTEMPTS) {
      return this.applyFresh(locked, transaction, 'invalid_choice_limit');
    }
    const next = {
      ...locked.reentryJson,
      status: 'awaiting_choice',
      invalidAttempts: nextCount,
    };
    const updated = await this.conversationRepo.updateConversation(
      locked.id,
      {
        reentryJson: next,
        currentNodeKey: null,
        status: 'bot',
        assignedAgentId: null,
      },
      { transaction },
    );
    return {
      action: 'reprompt',
      reply: REENTRY_PROMPT,
      conversation: updated,
      nodeKey: null,
      reason: 'invalid_choice',
    };
  }

  async applyFresh(locked, transaction, reason) {
    await this.sessionRepo.endAllOpenForConversation(locked.id, new Date(), { transaction });
    const updated = await this.conversationRepo.updateConversation(
      locked.id,
      {
        reentryJson: null,
        currentNodeKey: null,
        status: 'bot',
        assignedAgentId: null,
      },
      { transaction },
    );
    return { action: 'present_entry', conversation: updated, reason, nodeKey: null };
  }

  async applyContinue(locked, transaction) {
    const target = await this.resolveResumeTarget(locked.reentryJson);
    if (!target || target.decision === 'restart') {
      return this.applyFresh(locked, transaction, target?.reason || 'resume_unavailable');
    }

    await this.sessionRepo.endAllOpenForConversation(locked.id, new Date(), { transaction });
    const reentry = locked.reentryJson;
    const dbSession = await this.sessionRepo.createSession(
      {
        conversationId: locked.id,
        flowId: target.flowId,
        flowVersion: target.flowVersion,
        currentNodeKey: target.nodeKey,
        variablesJson: reentry.variables || {},
        historyJson: reentry.history || [],
        trackingJson: reentry.tracking || {},
        status: 'active',
      },
      { transaction },
    );
    const updated = await this.conversationRepo.updateConversation(
      locked.id,
      {
        reentryJson: null,
        status: 'bot',
        assignedAgentId: null,
        currentFlowId: target.flowId,
        currentFlowVersion: target.flowVersion,
        currentNodeKey: target.nodeKey,
      },
      { transaction },
    );
    return {
      action: 'present_node',
      reply: target.message,
      conversation: updated,
      dbSession,
      nodeKey: target.nodeKey,
      reason: target.reason,
      runtime: {
        variables: reentry.variables || {},
        history: reentry.history || [],
        tracking: reentry.tracking || {},
      },
    };
  }

  async applyHuman(locked, transaction) {
    const flowId = locked.reentryJson?.flowId || locked.currentFlowId || null;
    const handoffResult = await this.handoffService.requestHumanHandoff(locked, {
      engineResult: {
        currentNodeId: 'human_handoff',
        flowId,
        reply: DEFAULT_HANDOFF_MESSAGE,
        requiresHuman: true,
        terminalReason: 'human_handoff',
      },
      dbSession: null,
      transaction,
      clearReentry: true,
      deferNotify: true,
    });
    return {
      action: 'handoff',
      reply: handoffResult.confirmationMessage,
      conversation: handoffResult.conversation,
      handoff: handoffResult.handoff,
      nodeKey: handoffResult.nodeKey,
      reason: 'new_handoff',
    };
  }

  async restoreRuntime(result) {
    const userId = result?.conversation?.externalUserId;
    if (!userId || !result.nodeKey) return;
    const flowId = result.conversation.currentFlowId || 'main-menu';
    await this.runtimeSession.createSession(userId, flowId, result.nodeKey, {
      flowVersion: result.conversation.currentFlowVersion || null,
    });
    await this.runtimeSession.updateSession(userId, {
      currentNode: result.nodeKey,
      variables: result.runtime?.variables || {},
      __historyOverride: result.runtime?.history || [],
      __skipHistoryPush: true,
      answers: result.runtime?.tracking?.answers || {},
      visitedNodes: result.runtime?.tracking?.visitedNodes || [],
      transitionTrail: result.runtime?.tracking?.transitionTrail || [],
      flowVersion: result.conversation.currentFlowVersion || null,
    });
  }
}

const conversationReentryService = new ConversationReentryService();
export default conversationReentryService;
