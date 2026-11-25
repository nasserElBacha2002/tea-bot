import sessionService from './session.service.js';
import googleSheetsService from './googleSheets.service.js';
import conversationSheetFormatterService from './conversationSheetFormatter.service.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSheetExportRepository from '../repositories/conversation-sheet-export.repository.js';
import { resolveContactEmail } from './contact-email.service.js';
import flowLoader from '../utils/flow-loader.js';
import { config } from '../config.js';
import classificationReconciliationService from './conversationClassification/classificationReconciliation.service.js';
import conversationSheetExportService from './conversationSheetExport.service.js';
import {
  formatDetalleForExport,
  pickExportClassification,
} from './conversationClassification/classificationResolver.service.js';
import {
  buildExportSession,
  rehydrateExportSessionFromConversation,
} from './export-session-merge.service.js';
import {
  classifySheetSyncResult,
  shouldPersistEscalationExportedAt,
  shouldPersistPrimaryExportedAt,
  isRecoverableExportOutcome,
  isRecoverableExportException,
  SHEET_EXPORT_OUTCOMES,
} from './sheet-export-outcome.js';

const HUMAN_ESCALATION_STATUSES = new Set(['human_handoff', 'fallback_handoff']);

class ConversationExportService {
  async _resolveConversationForSession(userId, session, context = {}) {
    if (!conversationRepository.isEnabled()) return null;
    try {
      if (context.conversationId) {
        const explicit = await conversationRepository.findById(context.conversationId);
        if (!explicit) {
          return null;
        }
        if (session?.phone && explicit.phoneNumber) {
          const rawPhone = String(session.phone)
            .replace(/^twilio:/i, '')
            .replace(/^meta:/i, '')
            .replace(/^whatsapp:/i, '')
            .trim();
          if (rawPhone && explicit.phoneNumber !== rawPhone) {
            console.warn(
              `[ConversationExport] identity_mismatch conversationId=${explicit.id}`,
            );
            return null;
          }
        }
        if (context.flowId && explicit.currentFlowId && String(context.flowId) !== String(explicit.currentFlowId)) {
          return null;
        }
        if (context.flowVersion && explicit.currentFlowVersion
          && String(context.flowVersion) !== String(explicit.currentFlowVersion)) {
          return null;
        }
        if (context.channel && explicit.channel && context.channel !== explicit.channel) {
          return null;
        }
        return explicit;
      }
      const channel = context.channel || 'whatsapp';
      return await conversationRepository.findByChannelAndExternalUserId(channel, userId);
    } catch (error) {
      console.warn(`[ConversationExport] conversation_lookup_failed reason=${error.message}`);
      return null;
    }
  }

  async _resolveFlowForLabels(session, context = {}) {
    const flowId = session?.flowId || context.flowId;
    if (!flowId) return null;
    try {
      return await flowLoader.getFlow(flowId);
    } catch {
      return null;
    }
  }

  async exportFinalizedConversation(userId, finalStatus, context = {}, perfContext = null) {
    const activeRuntimeSession = sessionService.getSession(userId, perfContext);
    let runtimeSession = activeRuntimeSession;
    let conversation = await this._resolveConversationForSession(userId, runtimeSession, context);
    const historicalExport = Boolean(context.exportHistorical) || conversation?.status === 'closed';
    const exportConversationId = context.conversationId || conversation?.id || null;
    const mutateRuntimeSession = !historicalExport
      && (!exportConversationId || !activeRuntimeSession?.conversationId
        || String(activeRuntimeSession.conversationId) === String(exportConversationId));

    if (historicalExport && conversation) {
      runtimeSession = await rehydrateExportSessionFromConversation(conversation);
      if (!runtimeSession) {
        return {
          exported: false,
          reason: 'historical_context_missing',
          outcome: 'historical_context_missing',
          skipped: true,
        };
      }
    } else if (!runtimeSession && conversation) {
      runtimeSession = await rehydrateExportSessionFromConversation(conversation);
    }

    if (!runtimeSession) {
      return { exported: false, reason: 'no_session', outcome: 'no_session' };
    }

    const alreadyExported = historicalExport
      ? false
      : Boolean(runtimeSession.exportedAt);
    const canEscalateAfterExport = alreadyExported
      && HUMAN_ESCALATION_STATUSES.has(finalStatus)
      && !HUMAN_ESCALATION_STATUSES.has(runtimeSession.finalStatus);
    const canRetryAfterFailure = Boolean(
      runtimeSession.exportErrorAt
      || runtimeSession.exportPendingAt,
    );

    if (alreadyExported && !canEscalateAfterExport && !canRetryAfterFailure) {
      const conversationIdForVerify = conversation?.id || null;
      let verified = false;
      if (conversationIdForVerify && conversationSheetExportRepository.isEnabled()) {
        const tabName = config.googleSheetsTabName;
        const ledger = await conversationSheetExportRepository.findLatestByConversationAndTab(
          conversationIdForVerify,
          tabName,
        );
        verified = Boolean(
          ledger?.sheetRowNumber
          && ledger?.coordinatorState === 'confirmed'
          && ['appended', 'updated', 'reconciled', 'confirmed'].includes(String(ledger?.exportStatus || '')),
        );
      }
      return {
        exported: false,
        reason: 'already_exported',
        outcome: verified ? 'already_exported_verified' : 'duplicate_prevented',
      };
    }

    const nowIso = new Date().toISOString();
    if (context.conversationId && !conversation) {
      return {
        exported: false,
        reason: 'identity_rejected',
        outcome: SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT,
        skipped: true,
      };
    }
    conversation = conversation || await this._resolveConversationForSession(userId, runtimeSession, context);
    if (context.conversationId && (!conversation || conversation.id !== context.conversationId)) {
      return {
        exported: false,
        reason: 'identity_rejected',
        outcome: SHEET_EXPORT_OUTCOMES.IDENTITY_CONFLICT,
        skipped: true,
      };
    }
    const conversationId = conversation?.id ?? null;

    const { session, source: exportSessionSource, conflict: trackingConflict } = await buildExportSession({
      session: runtimeSession,
      conversationId,
      conversation,
    });

    const flow = await this._resolveFlowForLabels(session, context);
    const contactEmail = conversation ? await resolveContactEmail(conversation) : null;

    const shouldClassify =
      config.conversationClassificationMode !== 'legacy'
      || config.conversationClassificationLoggingEnabled
      || config.conversationClassificationMetricsEnabled
      || Boolean(conversationId);

    let classificationResolution = null;
    if (shouldClassify) {
      classificationResolution = await classificationReconciliationService.classifySessionForExport(
        session,
        conversationId,
        { persist: Boolean(conversationId) },
      );
    }

    const useV2Export = config.conversationClassificationMode === 'enabled';
    const exportClassification = useV2Export && classificationResolution
      ? pickExportClassification(classificationResolution, 'enabled')
      : null;
    const detalleConsulta = exportClassification ? formatDetalleForExport(exportClassification) : null;

    const formatted = conversationSheetFormatterService.formatHumanRecord({
      session,
      finalStatus,
      context,
      nowIso,
      flow,
      contactEmail,
      conversationId,
      exportClassification: useV2Export ? exportClassification : null,
      detalleConsulta,
    });

    const sheetsEnabled = googleSheetsService.isEnabled() && googleSheetsService.hasRequiredConfig();

    try {
      const useIdempotentExport =
        conversationSheetExportRepository.isEnabled()
        && Boolean(conversationId);

      const res = useIdempotentExport
        ? await conversationSheetExportService.syncFormattedRow({
          conversationId,
          finalStatus,
          headers: formatted.headers,
          row: formatted.row,
          escalation: canEscalateAfterExport,
        })
        : await googleSheetsService.appendConversationRow(formatted.row, {
          headers: formatted.headers,
        });

      const classified = classifySheetSyncResult(res, {
        sheetsEnabled,
        escalation: canEscalateAfterExport,
      });

      const rawTab = String(config.googleSheetsRawTabName || '').trim();
      const rawOncePerConversation = Boolean(conversationId);
      const rawEventKey = conversationId
        ? `raw:${conversationId}:${finalStatus}:${session.flowVersion || context.flowVersion || 'v0'}`
        : `raw:session:${userId}:${finalStatus}:${nowIso}`;
      let ledgerForRaw = null;
      if (conversationId && conversationSheetExportRepository.isEnabled()) {
        ledgerForRaw = await conversationSheetExportRepository.findLatestByConversationAndTab(
          conversationId,
          config.googleSheetsTabName,
        );
      }
      const rawAlreadyConfirmed = ledgerForRaw?.rawExportStatus === 'confirmed'
        && ledgerForRaw?.rawExportKey === rawEventKey;
      const rawNeedsRetry = ledgerForRaw?.rawExportStatus === 'failed';
      if (rawTab && sheetsEnabled && (!rawAlreadyConfirmed || rawNeedsRetry)) {
        const rawHeaders = ['timestamp', 'finalStatus', 'flowId', 'flowVersion', 'conversationId', 'raw'];
        const rawRow = [
          nowIso,
          finalStatus,
          session.flowId || context.flowId || '',
          session.flowVersion || context.flowVersion || '',
          conversationId || '',
          JSON.stringify(formatted.technicalData),
        ];
        try {
          const rawRes = await googleSheetsService.appendConversationRow(rawRow, {
            tabName: rawTab,
            headers: rawHeaders,
          });
          if (ledgerForRaw?.id && !rawRes?.skipped) {
            await conversationSheetExportRepository.updateRawExportState(ledgerForRaw.id, {
              rawExportStatus: 'confirmed',
              rawExportKey: rawEventKey,
            });
          }
        } catch (rawErr) {
          if (ledgerForRaw?.id) {
            await conversationSheetExportRepository.updateRawExportState(ledgerForRaw.id, {
              rawExportStatus: 'failed',
              rawExportKey: rawEventKey,
            });
          }
          console.warn(`[ConversationExport] raw_export_failed conversationId=${conversationId || '—'} reason=${rawErr.message}`);
        }
      }

      const sessionPatch = {
        finalStatus,
        finalReason: context.reason || '',
      };

      if (shouldPersistPrimaryExportedAt(classified.outcome) && !alreadyExported) {
        sessionPatch.exportedAt = nowIso;
        sessionPatch.exportErrorAt = null;
        sessionPatch.exportErrorMessage = null;
        sessionPatch.exportPendingAt = null;
      } else if (shouldPersistEscalationExportedAt(classified.outcome)) {
        sessionPatch.exportedEscalationAt = nowIso;
        sessionPatch.exportErrorAt = null;
        sessionPatch.exportPendingAt = null;
      } else if (isRecoverableExportOutcome(classified.outcome, classified.reason)) {
        sessionPatch.exportPendingAt = nowIso;
        sessionPatch.exportErrorAt = nowIso;
        sessionPatch.exportErrorMessage = String(classified.reason || classified.outcome).slice(0, 500);
      } else if (classified.outcome === 'intentionally_disabled') {
        sessionPatch.exportPendingAt = nowIso;
      }

      if (classified.skipped) {
        console.warn(
          `[ConversationExport] skip conversationId=${conversationId || '—'} outcome=${classified.outcome} reason=${classified.reason || ''}`,
        );
      } else if (classified.exported) {
        console.log(
          `[ConversationExport] exported status=${finalStatus} conversationId=${conversationId || '—'}`
          + ` outcome=${classified.outcome}`
          + ` sessionSource=${exportSessionSource}`
          + (trackingConflict ? ' trackingConflict=1' : '')
          + (res.operation ? ` sheetOp=${res.operation}` : ''),
        );
      }

      if (mutateRuntimeSession) {
        await sessionService.updateSession(userId, sessionPatch, perfContext);
      }

      return {
        exported: classified.exported,
        skipped: classified.skipped,
        reason: classified.reason || '',
        outcome: classified.outcome,
        classification: classificationResolution?.classification || null,
        shadowDiff: classificationResolution?.shadowDiff || false,
      };
    } catch (error) {
      const recoverable = isRecoverableExportException(error);
      const outcome = recoverable
        ? SHEET_EXPORT_OUTCOMES.RECOVERABLE_ERROR
        : SHEET_EXPORT_OUTCOMES.DEFINITIVE_ERROR;
      console.error(`[ConversationExport] failed status=${finalStatus} conversationId=${conversationId || '—'}: ${error.message}`);
      if (mutateRuntimeSession) {
        await sessionService.updateSession(
          userId,
          {
            exportErrorAt: nowIso,
            exportErrorMessage: error.message.slice(0, 500),
            exportPendingAt: nowIso,
          },
          perfContext,
        );
      }
      return {
        exported: false,
        skipped: recoverable,
        reason: recoverable ? 'recoverable_error' : 'error',
        outcome,
        error: error.message,
      };
    }
  }
}

const conversationExportService = new ConversationExportService();
export default conversationExportService;