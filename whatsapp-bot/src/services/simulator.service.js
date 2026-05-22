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

  async sendMessage({ sessionId, text }) {
    const userId = this.getSimulationId(sessionId);
    const trimmed = String(text ?? '').trim();

    const activeConv = await simulatorPersistenceService.findActiveBySessionId(sessionId);
    if (activeConv && isConversationInHumanMode(activeConv)) {
      const persistence = await simulatorPersistenceService.persistHumanModeInbound(
        sessionId,
        trimmed,
      );
      return {
        sessionId,
        reply: '',
        flowId: activeConv.currentFlowId,
        currentNodeId: activeConv.currentNodeKey,
        variables: sessionService.getSession(userId)?.variables ?? {},
        requiresHuman: true,
        conversationId: persistence?.conversationId ?? activeConv.id,
      };
    }

    const prep = await simulatorPersistenceService.persistUserInputBeforeEngine({
      sessionId,
      text: trimmed,
      flowId: activeConv?.currentFlowId ?? null,
      flowVersion: this._flowVersionFromSession(userId),
    });

    const result = await flowEngine.resolveIncomingMessage({
      userId,
      text: trimmed,
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
