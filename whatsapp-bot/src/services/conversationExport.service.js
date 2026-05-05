import sessionService from './session.service.js';
import googleSheetsService from './googleSheets.service.js';
import conversationSheetFormatterService from './conversationSheetFormatter.service.js';
import flowLoader from '../utils/flow-loader.js';
import { config } from '../config.js';

const HUMAN_ESCALATION_STATUSES = new Set(['human_handoff', 'fallback_handoff']);

class ConversationExportService {
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
    const formatted = conversationSheetFormatterService.formatHumanRecord({
      session,
      finalStatus,
      context,
      nowIso,
      flow,
    });

    try {
      const res = await googleSheetsService.appendConversationRow(formatted.row, {
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
        console.log(`[ConversationExport] exported status=${finalStatus} user=${session.provider}:${session.phone}`);
      }
      await sessionService.updateSession(
        userId,
        {
          exportedAt: nowIso,
          ...(canEscalateAfterExport ? { exportedEscalationAt: nowIso } : {}),
          finalStatus,
          finalReason: context.reason || '',
        },
        perfContext
      );
      return { exported: !res.skipped, skipped: res.skipped, reason: res.reason || '' };
    } catch (error) {
      console.error(`[ConversationExport] failed status=${finalStatus}: ${error.message}`);
      await sessionService.updateSession(
        userId,
        { exportErrorAt: nowIso, exportErrorMessage: error.message.slice(0, 500) },
        perfContext
      );
      return { exported: false, reason: 'error', error: error.message };
    }
  }
}

const conversationExportService = new ConversationExportService();
export default conversationExportService;
