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
import { formatDetalleForExport } from './conversationClassification/classificationResolver.service.js';

const HUMAN_ESCALATION_STATUSES = new Set(['human_handoff', 'fallback_handoff']);

class ConversationExportService {
  async _resolveConversationForSession(userId, session) {
    if (!conversationRepository.isEnabled()) return null;
    try {
      const channel = 'whatsapp';
      let conversation = await conversationRepository.findByChannelAndExternalUserId(channel, userId);
      if (!conversation && session?.phone) {
        const rawPhone = String(session.phone)
          .replace(/^twilio:/i, '')
          .replace(/^meta:/i, '')
          .replace(/^whatsapp:/i, '')
          .trim();
        conversation = await conversationRepository.findByPhoneNumber(rawPhone);
      }
      return conversation;
    } catch (error) {
      console.warn(`[ConversationExport] conversation_lookup_failed user=${userId} reason=${error.message}`);
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
    const session = sessionService.getSession(userId, perfContext);
    if (!session) return { exported: false, reason: 'no_session' };
    const alreadyExported = Boolean(session.exportedAt);
    const canEscalateAfterExport = alreadyExported
      && HUMAN_ESCALATION_STATUSES.has(finalStatus)
      && !HUMAN_ESCALATION_STATUSES.has(session.finalStatus);
    if (alreadyExported && !canEscalateAfterExport) return { exported: false, reason: 'already_exported' };

    const nowIso = new Date().toISOString();
    const flow = await this._resolveFlowForLabels(session, context);
    const conversation = await this._resolveConversationForSession(userId, session);
    const conversationId = conversation?.id || null;
    const contactEmail = conversation ? resolveContactEmail(conversation) : null;

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
    const exportClassification = useV2Export
      ? classificationResolution?.exportClassification || null
      : null;
    const detalleConsulta = exportClassification
      ? formatDetalleForExport(exportClassification)
      : null;

    const formatted = conversationSheetFormatterService.formatHumanRecord({
      session,
      finalStatus,
      context,
      nowIso,
      flow,
      contactEmail,
      conversationId,
      exportClassification,
      detalleConsulta,
    });

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

      const rawTab = String(config.googleSheetsRawTabName || '').trim();
      if (rawTab) {
        const rawHeaders = ['timestamp', 'finalStatus', 'flowId', 'flowVersion', 'raw'];
        const rawRow = [
          nowIso,
          finalStatus,
          session.flowId || context.flowId || '',
          session.flowVersion || context.flowVersion || '',
          JSON.stringify(formatted.technicalData),
        ];
        try {
          await googleSheetsService.appendConversationRow(rawRow, {
            tabName: rawTab,
            headers: rawHeaders,
          });
        } catch (rawErr) {
          console.warn(`[ConversationExport] raw_export_failed user=${session.provider}:${session.phone} reason=${rawErr.message}`);
        }
      }

      if (res.skipped) {
        console.warn(`[ConversationExport] skip user=${session.provider}:${session.phone} reason=${res.reason}`);
      } else {
        console.log(
          `[ConversationExport] exported status=${finalStatus} user=${session.provider}:${session.phone}`
          + (res.operation ? ` sheetOp=${res.operation}` : ''),
        );
      }

      await sessionService.updateSession(
        userId,
        {
          exportedAt: alreadyExported ? session.exportedAt : nowIso,
          ...(canEscalateAfterExport ? { exportedEscalationAt: nowIso } : {}),
          finalStatus,
          finalReason: context.reason || '',
        },
        perfContext,
      );

      return {
        exported: !res.skipped,
        skipped: res.skipped,
        reason: res.reason || '',
        classification: classificationResolution?.classification || null,
        shadowDiff: classificationResolution?.shadowDiff || false,
      };
    } catch (error) {
      console.error(`[ConversationExport] failed status=${finalStatus}: ${error.message}`);
      await sessionService.updateSession(
        userId,
        { exportErrorAt: nowIso, exportErrorMessage: error.message.slice(0, 500) },
        perfContext,
      );
      return { exported: false, reason: 'error', error: error.message };
    }
  }
}

const conversationExportService = new ConversationExportService();
export default conversationExportService;
