import { withTransaction } from '../db/index.js';
import conversationRepository from '../repositories/conversation.repository.js';
import { isConversationDbEnabled } from '../db/index.js';
import { isManualTakeoverEnabled } from '../utils/manual-takeover-flag.js';

const PERSISTED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REPLY_DECISION = Object.freeze({
  ALLOW: 'ALLOW',
  SUPPRESS: 'SUPPRESS',
  INDETERMINATE: 'INDETERMINATE',
});

function result(decision, reason, conversation = null, extra = {}) {
  const payload = {
    decision,
    reason,
    suppress: decision === REPLY_DECISION.SUPPRESS,
    conversation,
    persisted: extra.persisted || null,
  };
  if (decision === REPLY_DECISION.INDETERMINATE) {
    console.error(JSON.stringify({
      event: 'automatic_reply_indeterminate',
      reason,
      conversationId: conversation?.id || extra.conversationId || null,
    }));
  }
  return payload;
}

function versionMismatch(start, current) {
  if (start == null || current == null) return 'version_required';
  if (!Number.isInteger(start) || !Number.isInteger(current)) return 'version_inconsistent';
  if (start !== current) return 'version_mismatch';
  return null;
}

/**
 * Autoriza una respuesta automática y, si corresponde, persiste el outbound
 * dentro de la misma transacción que bloquea la fila.
 * El commit termina antes de construir TwiML o llamar a Twilio.
 *
 * ALLOW en conversaciones no persistidas o con la base apagada es una regla
 * explícita de compatibilidad. Una fila persistida nunca se autoriza si SQL,
 * la fila, la versión o el esquema no se pueden verificar.
 */
export async function authorizeAutomaticReply({
  conversation,
  statusVersionAtStart = null,
  persist = null,
} = {}, deps = {}) {
  const id = conversation?.id ? String(conversation.id) : '';
  if (!id || !PERSISTED_ID.test(id)) {
    return result(REPLY_DECISION.ALLOW, 'unpersisted', conversation);
  }

  const dbEnabled = deps.dbEnabled || isConversationDbEnabled;
  if (!dbEnabled()) {
    return result(REPLY_DECISION.ALLOW, 'persistence_disabled', conversation);
  }

  const runTransaction = deps.runTransaction || withTransaction;
  const repo = deps.conversationRepo || conversationRepository;
  const takeoverEnabled = deps.takeoverEnabled || isManualTakeoverEnabled;
  const schemaReady = deps.schemaReady || (async () => {
    if (typeof repo.hasStatusVersionColumn !== 'function') return false;
    return repo.hasStatusVersionColumn();
  });

  try {
    return await runTransaction(async (transaction) => {
      let locked;
      try {
        locked = await repo.findByIdForUpdate(id, { transaction });
      } catch (error) {
        return result(REPLY_DECISION.INDETERMINATE, 'sql_error', conversation, { conversationId: id });
      }
      if (!locked) {
        return result(REPLY_DECISION.INDETERMINATE, 'missing_row', conversation, { conversationId: id });
      }

      if (locked.status !== 'bot') {
        return result(REPLY_DECISION.SUPPRESS, 'not_bot', locked);
      }

      if (locked.statusVersion == null) {
        let ready = false;
        try {
          ready = await schemaReady();
        } catch (error) {
          return result(REPLY_DECISION.INDETERMINATE, 'sql_error', locked);
        }
        if (!ready) {
          if (takeoverEnabled()) {
            return result(REPLY_DECISION.INDETERMINATE, 'takeover_schema_required', locked);
          }
          const persisted = persist ? await persist(transaction, locked) : null;
          return result(REPLY_DECISION.ALLOW, 'schema_absent', locked, { persisted });
        }
        return result(REPLY_DECISION.INDETERMINATE, 'version_required', locked);
      }

      const mismatch = versionMismatch(
        statusVersionAtStart == null ? null : Number(statusVersionAtStart),
        Number(locked.statusVersion),
      );
      if (mismatch === 'version_mismatch') {
        return result(REPLY_DECISION.SUPPRESS, 'version_mismatch', locked);
      }
      if (mismatch) {
        return result(REPLY_DECISION.INDETERMINATE, mismatch, locked);
      }

      const persisted = persist ? await persist(transaction, locked) : null;
      return result(REPLY_DECISION.ALLOW, 'authorized', locked, { persisted });
    });
  } catch (error) {
    return result(REPLY_DECISION.INDETERMINATE, 'transaction_error', conversation, { conversationId: id });
  }
}

export async function evaluateAutomaticReply(conversation, statusVersionAtStart, deps = {}) {
  return authorizeAutomaticReply({
    conversation,
    statusVersionAtStart,
  }, deps);
}

export const conversationTurnGuard = {
  authorizeAutomaticReply,
  evaluateAutomaticReply,
  async suppressAutomaticReply(conversation, statusVersionAtStart) {
    return evaluateAutomaticReply(conversation, statusVersionAtStart);
  },
};
