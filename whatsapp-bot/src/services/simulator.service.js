import flowEngine from './flow-engine.service.js';
import sessionService from './session.service.js';
import simulatorPersistenceService, {
  simulatorRuntimeUserId,
} from './simulator-persistence.service.js';
import { isConversationInHumanMode } from '../utils/handoff-detection.js';

class SimulatorService {
  getSimulationId(sessionId) {
    return simulatorRuntimeUserId(sessionId);
  }

  _flowVersionFromSession(userId) {
    const s = sessionService.getSession(userId);
    return s?.flowVersion ?? null;
  }

  async startSimulation({ sessionId, flowId, flowSnapshot, useDraftSnapshot = false }) {
    const userId = this.getSimulationId(sessionId);

    await sessionService.resetSession(userId);

    const useSnapshot = Boolean(useDraftSnapshot && flowSnapshot);
    const result = await flowEngine.resolveIncomingMessage({
      userId,
      text: '',
      flowMode: useSnapshot ? 'draft' : 'published',
      flowId,
      flowSnapshot: useSnapshot ? flowSnapshot : undefined,
    });

    const flowVersion = this._flowVersionFromSession(userId);
    const persistence = await simulatorPersistenceService.persistEngineResponseAfter({
      sessionId,
      engineResult: result,
      flowId: result.flowId || flowId,
      flowVersion,
      isStart: true,
    });

    return {
      sessionId,
      ...result,
      conversationId: persistence?.conversationId ?? null,
    };
  }

  async sendMessage({ sessionId, text, attachment = null }) {
    const userId = this.getSimulationId(sessionId);
    const trimmed = String(text ?? '').trim();
    const hasAttachment = Boolean(attachment?.contentBase64);
    if (!trimmed && !hasAttachment) {
      throw new Error('text o attachment es requerido');
    }

    const activeConv = await simulatorPersistenceService.findActiveBySessionId(sessionId);
    if (activeConv && isConversationInHumanMode(activeConv)) {
      const persistence = await simulatorPersistenceService.persistHumanModeInbound(
        sessionId,
        trimmed,
        attachment,
      );
      return {
        sessionId,
        reply: '',
        flowId: activeConv.currentFlowId,
        currentNodeId: activeConv.currentNodeKey,
        variables: sessionService.getSession(userId)?.variables ?? {},
        requiresHuman: true,
        conversationId: persistence?.conversationId ?? activeConv.id,
        inboundMessage: persistence?.inboundMessage ?? null,
      };
    }

    const prep = await simulatorPersistenceService.persistUserInputBeforeEngine({
      sessionId,
      text: trimmed,
      attachment,
      flowId: activeConv?.currentFlowId ?? null,
      flowVersion: this._flowVersionFromSession(userId),
    });

    if (prep?.mediaOnly) {
      return {
        sessionId,
        reply: '',
        flowId: prep.conversation?.currentFlowId ?? activeConv?.currentFlowId ?? null,
        currentNodeId: prep.conversation?.currentNodeKey ?? activeConv?.currentNodeKey ?? null,
        variables: sessionService.getSession(userId)?.variables ?? {},
        conversationId: prep.conversation?.id ?? null,
        inboundMessage: prep.inboundMessage ?? null,
        mediaOnly: true,
      };
    }

    const result = await flowEngine.resolveIncomingMessage({
      userId,
      text: trimmed,
      conversationContext: prep?.conversation ?? activeConv ?? null,
    });

    const flowVersion = this._flowVersionFromSession(userId);
    const persistence = await simulatorPersistenceService.persistEngineResponseAfter({
      sessionId,
      engineResult: result,
      flowId: result.flowId,
      flowVersion,
      conversation: prep?.conversation ?? null,
    });

    return {
      sessionId,
      ...result,
      conversationId: persistence?.conversationId ?? prep?.conversation?.id ?? null,
      inboundMessage: prep?.inboundMessage ?? null,
    };
  }

  async resetSimulation(sessionId) {
    const userId = this.getSimulationId(sessionId);
    await simulatorPersistenceService.closeSessionConversation(sessionId);
    await sessionService.resetSession(userId);
    return true;
  }
}

const simulatorService = new SimulatorService();
export default simulatorService;
