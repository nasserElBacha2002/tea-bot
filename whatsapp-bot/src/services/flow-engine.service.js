import flowRepository from '../repositories/flow.repository.js';
import flowLoader from '../utils/flow-loader.js';
import sessionService from './session.service.js';
import conversationTracker from './conversationTracker.service.js';
import conversationExportService from './conversationExport.service.js';
import { config } from '../config.js';
import { detectGlobalCommand } from '../utils/global-commands.js';
import { compileFlow } from '../utils/compile-flow.js';
import { logPerf, nowMs, roundMs } from '../utils/perf-timer.js';

function normalizeMessage(text) {
  return (text || '').trim().toLowerCase();
}

const HISTORY_LIMIT = 20;
const CANCEL_INPUTS = new Set(['salir', 'cancelar', 'terminar']);

export class FlowEngine {
  /**
   * Procesa el mensaje entrante y determina la siguiente respuesta y estado.
   * @param {Object} params - Parámetros de entrada.
   * @param {string} params.userId - El número de teléfono del usuario o ID de sesión.
   * @param {string} params.text - El texto enviado por el usuario.
   * @param {string} [params.flowMode='published'] - 'published' o 'draft'.
   * @param {string} [params.flowId] - Forzar un flowId específico (útil para iniciar simulaciones).
   * @returns {Object} - Respuesta estructurada { reply, flowId, currentNodeId, variables }.
   */
  async resolveIncomingMessage({
    userId,
    text,
    flowMode = 'published',
    flowId: explicitFlowId,
    flowSnapshot,
    perfContext = null,
  }) {
    const resolveStart = nowMs();
    const input = normalizeMessage(text);
    let session = sessionService.getSession(userId, perfContext);

    // 1. Manejo de Inicio Automático (Si no hay sesión)
    if (!session) {
      const targetFlowId = explicitFlowId || flowLoader.getDefaultFlowId();
      const useSnapshot =
        flowSnapshot
        && typeof flowSnapshot === 'object'
        && flowSnapshot.id === targetFlowId
        && Array.isArray(flowSnapshot.nodes);
      const flowBundle = useSnapshot
        ? {
          flow: flowSnapshot,
          compiled: compileFlow(flowSnapshot),
          flowSource: 'snapshot',
          flowCacheHit: true,
        }
        : await this.getFlow(targetFlowId, flowMode, null, perfContext);
      const flow = flowBundle.flow;
      const compiled = flowBundle.compiled;

      // Creamos la sesión en el nodo inicial (opcional: borrador en memoria para simulador del editor)
      session = await sessionService.createSession(
        userId,
        targetFlowId,
        flow.entryNode,
        {
          ...(useSnapshot ? { simulatorFlowOverride: flowSnapshot } : {}),
        },
        perfContext
      );
      session = await conversationTracker.ensureSessionContext(userId, flow, session, perfContext);
      await sessionService.updateSession(
        userId,
        conversationTracker.buildMessagePatch(text),
        perfContext
      );

      const entryLookupStart = nowMs();
      const entryNode = this._getNode(compiled, flow, flow.entryNode);
      perfContext?.add?.('entryNodeLookupMs', roundMs(nowMs() - entryLookupStart));
      if (!entryNode) {
        console.warn(
          `[FlowEngine] entryNode "${flow.entryNode}" no existe en flujo "${targetFlowId}".`,
        );
        throw new Error(
          `[FlowEngine] entryNode "${flow.entryNode}" no existe en el flujo "${targetFlowId}".`,
        );
      }

      // Si el entryNode es un redirect, lo procesamos recursivamente
      if (entryNode.type === 'redirect') {
        perfContext?.add?.('wasRedirect', true);
        const result = await this.processNode(
          userId,
          entryNode,
          compiled,
          flow,
          {},
          session,
          '',
          flowMode,
          perfContext
        );
        perfContext?.add?.('resolveIncomingMessageMs', roundMs(nowMs() - resolveStart));
        return result;
      }

      const result = {
        reply: entryNode.message,
        flowId: session.flowId,
        currentNodeId: session.currentNode,
        variables: session.variables,
      };
      perfContext?.add?.('currentNodeId', session.currentNode);
      perfContext?.add?.('resolveIncomingMessageMs', roundMs(nowMs() - resolveStart));
      logPerf('flow_resolve', {
        flowId: flow.id,
        version: flow.version,
        nodeId: session.currentNode,
        resolveMs: perfContext?.toJSON?.().resolveIncomingMessageMs,
        globalCommand: null,
        matched: 'entry',
      });
      return result;
    }

    // 2. Cargar flujo y nodo actual de la sesión existente
    const flowBundle = await this.getFlow(session.flowId, flowMode, session, perfContext);
    const flow = flowBundle.flow;
    const compiled = flowBundle.compiled;
    session = await conversationTracker.ensureSessionContext(userId, flow, session, perfContext);
    await sessionService.updateSession(
      userId,
      conversationTracker.buildMessagePatch(text),
      perfContext
    );
    session = sessionService.getSession(userId, perfContext) || session;
    const nodeLookupStart = nowMs();
    const currentNodeId = session.currentNode || session.nodeId;
    let currentNode = this._getNode(compiled, flow, currentNodeId);
    perfContext?.add?.('currentNodeLookupMs', roundMs(nowMs() - nodeLookupStart));

    if (!currentNode) {
      console.warn(
        `[FlowEngine] Sesión corrupta: nodo "${session.currentNode}" inexistente en "${session.flowId}". Reiniciando conversación.`,
      );
      await sessionService.resetSession(userId, perfContext);
      return this.resolveIncomingMessage({
        userId,
        text,
        flowMode,
        flowId: explicitFlowId,
        flowSnapshot,
        perfContext,
      });
    }

    if (CANCEL_INPUTS.has(input)) {
      await conversationExportService.exportFinalizedConversation(
        userId,
        'cancelled_by_user',
        {
          flowId: flow.id,
          flowVersion: flow.version,
          reason: 'cancelled_by_user',
          lastNodeId: currentNode.id,
        },
        perfContext
      );
      await sessionService.resetSession(userId, perfContext);
      return {
        reply: 'Perfecto, cerramos la conversación por ahora. Si querés volver, escribinos cuando quieras.',
        flowId: flow.id,
        currentNodeId: null,
        variables: {},
      };
    }

    const globalCommand = detectGlobalCommand(input);
    if (globalCommand.type) {
      const globalResult = await this._resolveGlobalCommand({
        globalCommand: globalCommand.type,
        userId,
        flow,
        compiled,
        session,
        flowMode,
        perfContext,
      });
      if (globalResult) {
        perfContext?.add?.('globalCommand', globalCommand.type);
        perfContext?.add?.('resolveIncomingMessageMs', roundMs(nowMs() - resolveStart));
        logPerf('flow_resolve', {
          flowId: flow.id,
          version: flow.version,
          nodeId: globalResult.currentNodeId,
          resolveMs: perfContext?.toJSON?.().resolveIncomingMessageMs,
          globalCommand: globalCommand.type,
          matched: 'global',
        });
        return globalResult;
      }
    }

    // 3. Evaluar transiciones según el input del usuario
    const transitionStart = nowMs();
    const transitionStats = this._transitionStats(currentNode);
    const transitionEval = compiled
      ? this.evaluateCompiledTransitionsDetailed(compiled, currentNode.id, input, flow.fallbackNode)
      : this.evaluateTransitionsDetailed(currentNode, input, flow.fallbackNode);
    const nextNodeId = transitionEval.nextNodeId;
    perfContext?.add?.('transitionEvalMs', roundMs(nowMs() - transitionStart));
    perfContext?.add?.('currentNodeId', currentNode.id);
    perfContext?.add?.('nextNodeId', nextNodeId);
    perfContext?.add?.('transitionType', transitionEval.reason);
    perfContext?.add?.('transitionCount', transitionStats.transitionCount);
    perfContext?.add?.('transitionValuesCount', transitionStats.valueCount);
    perfContext?.add?.('fellBack', transitionEval.usedFallback);
    if (transitionEval.matchedTransition?.track) {
      const trackedPatch = conversationTracker.buildTrackingPatch(session, transitionEval.matchedTransition);
      if (Object.keys(trackedPatch).length > 0) {
        await sessionService.updateSession(userId, trackedPatch, perfContext);
        session = sessionService.getSession(userId, perfContext) || session;
      }
    }
    if (transitionEval.usedFallback) {
      await sessionService.updateSession(userId, conversationTracker.buildFallbackPatch(session), perfContext);
      session = sessionService.getSession(userId, perfContext) || session;
    }
    const nextLookupStart = nowMs();
    const nextNode = this._getNode(compiled, flow, nextNodeId);
    perfContext?.add?.('nextNodeLookupMs', roundMs(nowMs() - nextLookupStart));
    if (transitionEval.matchedTransition && nextNodeId) {
      const nextNodeLabel = nextNode
        ? (nextNode.label || nextNode.trackingLabel || nextNode.title || nextNode.name || '')
        : '';
      const transitionTrailPatch = conversationTracker.buildTransitionTrailPatch(
        session,
        currentNode.id,
        nextNodeId,
        transitionEval.matchedTransition,
        nextNodeLabel
      );
      if (Object.keys(transitionTrailPatch).length > 0) {
        await sessionService.updateSession(userId, transitionTrailPatch, perfContext);
        session = sessionService.getSession(userId, perfContext) || session;
      }
    }

    // 4. Procesar el siguiente nodo (lógica de tipo de nodo)
    const result = await this.processNode(
      userId,
      nextNode,
      compiled,
      flow,
      session.variables,
      session,
      input,
      flowMode,
      perfContext
    );
    perfContext?.add?.('resolveIncomingMessageMs', roundMs(nowMs() - resolveStart));
    logPerf('flow_resolve', {
      flowId: flow.id,
      version: flow.version,
      nodeId: result.currentNodeId,
      resolveMs: perfContext?.toJSON?.().resolveIncomingMessageMs,
      globalCommand: perfContext?.toJSON?.().globalCommand || null,
      matched: transitionEval.reason,
    });
    return result;
  }

  /**
   * Resuelve un flujo según el modo solicitado.
   */
  async getFlow(flowId, flowMode, session = null, perfContext = null) {
    const start = nowMs();
    if (session?.simulatorFlowOverride) {
      perfContext?.add?.('flowSource', 'session_override');
      perfContext?.add?.('flowCacheHit', true);
      perfContext?.add?.('getFlowMs', roundMs(nowMs() - start));
      const override = session.simulatorFlowOverride;
      return {
        flow: override,
        compiled: compileFlow(override),
      };
    }
    if (flowMode === 'draft') {
      const draft = await flowRepository.getDraft(flowId);
      if (!draft) throw new Error(`[FlowEngine] Draft "${flowId}" no encontrado.`);
      perfContext?.add?.('flowSource', 'draft_repo');
      perfContext?.add?.('flowCacheHit', false);
      perfContext?.add?.('getFlowMs', roundMs(nowMs() - start));
      return {
        flow: draft,
        compiled: compileFlow(draft),
      };
    }

    // Por defecto usamos el Loader (que cachea los published)
    const hasCache = flowLoader.hasFlow(flowId);
    const published = await flowLoader.getFlow(flowId);
    if (!published) {
      // Intento final desde repo por si el loader no refrescó
      const repoPublished = await flowRepository.getLatestPublished(flowId);
      if (!repoPublished) throw new Error(`[FlowEngine] Published "${flowId}" no encontrado.`);
      perfContext?.add?.('flowSource', 'published_repo_fallback');
      perfContext?.add?.('flowCacheHit', false);
      perfContext?.add?.('getFlowMs', roundMs(nowMs() - start));
      return {
        flow: repoPublished,
        compiled: compileFlow(repoPublished),
      };
    }
    perfContext?.add?.('flowSource', 'published_loader_cache');
    perfContext?.add?.('flowCacheHit', hasCache);
    perfContext?.add?.('getFlowMs', roundMs(nowMs() - start));
    return {
      flow: published,
      compiled: flowLoader.getCompiledFlow(flowId) || compileFlow(published),
    };
  }

  /**
   * Procesa la lógica específica de cada tipo de nodo y actualiza la sesión.
   */
  async processNode(
    userId,
    node,
    compiled,
    flow,
    variables = {},
    session = null,
    lastInput = '',
    flowMode = 'published',
    perfContext = null,
    options = {}
  ) {
    if (!node) {
      console.warn(`[FlowEngine] processNode: siguiente nodo ausente (userId=${userId}).`);
      await sessionService.resetSession(userId, perfContext);
      return {
        reply:
          'Tuvimos un problema al continuar la conversación. Enviá cualquier mensaje para empezar de nuevo.',
        flowId: flow.id,
        currentNodeId: null,
        variables: {},
      };
    }

    let currentVariables = { ...variables };

    // Lógica por tipo de nodo: 'capture' guarda el input en una variable
    if (node.type === 'capture' && node.variableName) {
      currentVariables[node.variableName] = lastInput;
    }

    // Actualizar sesión
    await sessionService.updateSession(userId, {
      currentNode: node.id,
      variables: currentVariables,
      ...conversationTracker.buildNodeVisitPatch(session, node.id),
      __skipHistoryPush: Boolean(options.skipHistoryPush),
      __resetHistory: Boolean(options.resetHistory),
      __historyOverride: Array.isArray(options.historyOverride) ? options.historyOverride : undefined,
    }, perfContext);

    // Si es un nodo de tipo 'redirect', saltamos automáticamente al siguiente sin esperar input
    if (node.type === 'redirect' && node.nextNode) {
      const targetNode = this._getNode(compiled, flow, node.nextNode);
      if (!targetNode) {
        console.warn(
          `[FlowEngine] redirect desde "${node.id}" apunta a nodo inexistente "${node.nextNode}".`,
        );
        await sessionService.resetSession(userId, perfContext);
        return {
          reply:
            'Tuvimos un problema al continuar la conversación. Enviá cualquier mensaje para empezar de nuevo.',
          flowId: flow.id,
          currentNodeId: null,
          variables: {},
        };
      }
      const refreshedSession = sessionService.getSession(userId, perfContext);
      return this.processNode(
        userId,
        targetNode,
        compiled,
        flow,
        currentVariables,
        refreshedSession,
        '',
        flowMode,
        perfContext,
        options
      );
    }

    // Si es un mensaje informativo que redirige después de mostrarse (en la PRÓXIMA interacción)
    if (node.type === 'message' && node.nextNode) {
      await sessionService.updateSession(userId, { currentNode: node.nextNode }, perfContext);
    }

    const terminalReason =
      node.isTerminal === true
        ? String(node.terminalReason || 'completed')
        : node.type === 'end'
          ? 'completed'
          : null;
    if (terminalReason) {
      await conversationExportService.exportFinalizedConversation(
        userId,
        terminalReason,
        {
          flowId: flow.id,
          flowVersion: flow.version,
          reason: terminalReason,
          lastNodeId: node.id,
          requiresHuman: terminalReason === 'human_handoff' || terminalReason === 'fallback_handoff',
        },
        perfContext
      );
    }
    if (config.exportInfoProvidedEvents && this._isInformationalResolutionNode(node) && !terminalReason) {
      await conversationExportService.exportFinalizedConversation(
        userId,
        'info_provided',
        {
          flowId: flow.id,
          flowVersion: flow.version,
          reason: 'info_provided',
          lastNodeId: node.id,
          requiresHuman: false,
        },
        perfContext
      );
    }

    // Si es 'end' o terminal, finalizamos la sesión
    if (node.type === 'end' || node.isTerminal === true) {
      await sessionService.resetSession(userId, perfContext);
    }

    return {
      reply: node.message,
      flowId: flow.id,
      currentNodeId: node.id,
      variables: currentVariables,
    };
  }

  /**
   * Evalúa las reglas de transición con la prioridad establecida:
   * 1. match
   * 2. matchAny
   * 3. matchIncludes
   * 4. default
   */
  evaluateTransitions(node, input, fallbackNodeId) {
    return this.evaluateTransitionsDetailed(node, input, fallbackNodeId).nextNodeId;
  }

  evaluateTransitionsDetailed(node, input, fallbackNodeId) {
    if (!node) {
      return {
        nextNodeId: fallbackNodeId,
        reason: 'node_missing',
        usedFallback: true,
        matchedTransition: null,
      };
    }
    if (!node.transitions || node.transitions.length === 0) {
      return {
        nextNodeId: node.nextNode || fallbackNodeId,
        reason: node.nextNode ? 'node_next' : 'fallback',
        usedFallback: !node.nextNode,
        matchedTransition: null,
      };
    }

    // 1. match (Coincidencia exacta)
    const matchTrans = node.transitions.find((t) => t.type === 'match' && input === normalizeMessage(t.value));
    if (matchTrans) {
      return { nextNodeId: matchTrans.nextNode, reason: 'match', usedFallback: false, matchedTransition: matchTrans };
    }

    // 2. matchAny (Cualquiera de la lista)
    const matchAnyTrans = node.transitions.find(
      (t) => t.type === 'matchAny'
        && Array.isArray(t.value)
        && t.value.some((v) => input === normalizeMessage(v)),
    );
    if (matchAnyTrans) {
      return {
        nextNodeId: matchAnyTrans.nextNode,
        reason: 'matchAny',
        usedFallback: false,
        matchedTransition: matchAnyTrans,
      };
    }

    // 3. matchIncludes (Contiene la palabra)
    const matchIncTrans = node.transitions.find(
      (t) => t.type === 'matchIncludes' && input.includes(normalizeMessage(t.value)),
    );
    if (matchIncTrans) {
      return {
        nextNodeId: matchIncTrans.nextNode,
        reason: 'matchIncludes',
        usedFallback: false,
        matchedTransition: matchIncTrans,
      };
    }

    // 4. default
    const defTrans = node.transitions.find((t) => t.type === 'default' || t.default === true);
    if (defTrans) {
      return { nextNodeId: defTrans.nextNode, reason: 'default', usedFallback: false, matchedTransition: defTrans };
    }

    return {
      nextNodeId: fallbackNodeId || node.id,
      reason: fallbackNodeId ? 'fallback' : 'stay_on_node',
      usedFallback: Boolean(fallbackNodeId),
      matchedTransition: null,
    };
  }

  evaluateCompiledTransitionsDetailed(compiled, nodeId, input, fallbackNodeId) {
    const node = compiled.nodesById.get(nodeId);
    if (!node) {
      return {
        nextNodeId: fallbackNodeId,
        reason: 'node_missing',
        usedFallback: true,
        matchedTransition: null,
      };
    }
    const transitions = compiled.transitionsByNodeId.get(nodeId) || [];
    if (transitions.length === 0) {
      return {
        nextNodeId: node.nextNode || fallbackNodeId,
        reason: node.nextNode ? 'node_next' : 'fallback',
        usedFallback: !node.nextNode,
        matchedTransition: null,
      };
    }

    const exact = compiled.exactMatchByNodeId.get(nodeId);
    const match = exact?.get(input);
    if (match) return { nextNodeId: match.nextNode, reason: 'exact', usedFallback: false, matchedTransition: match };

    const includes = compiled.includesRulesByNodeId.get(nodeId) || [];
    const includeMatch = includes.find((rule) => input.includes(rule.needle));
    if (includeMatch) {
      return {
        nextNodeId: includeMatch.transition.nextNode,
        reason: 'matchIncludes',
        usedFallback: false,
        matchedTransition: includeMatch.transition,
      };
    }

    const defaultTransition = compiled.defaultTransitionByNodeId.get(nodeId);
    if (defaultTransition) {
      return {
        nextNodeId: defaultTransition.nextNode,
        reason: 'default',
        usedFallback: false,
        matchedTransition: defaultTransition,
      };
    }

    return {
      nextNodeId: fallbackNodeId || node.id,
      reason: fallbackNodeId ? 'fallback' : 'stay_on_node',
      usedFallback: Boolean(fallbackNodeId),
      matchedTransition: null,
    };
  }

  async _resolveGlobalCommand({
    globalCommand,
    userId,
    flow,
    compiled,
    session,
    flowMode,
    perfContext,
  }) {
    if (globalCommand === 'menu') {
      const menuNode = this._getNode(compiled, flow, flow.entryNode);
      if (!menuNode) return null;
      const baseVariables = session?.variables || {};
      return this.processNode(
        userId,
        menuNode,
        compiled,
        flow,
        baseVariables,
        session,
        '',
        flowMode,
        perfContext,
        { resetHistory: true, skipHistoryPush: true, historyOverride: [] }
      );
    }

    if (globalCommand === 'back') {
      const history = Array.isArray(session?.history) ? [...session.history] : [];
      const previousNodeId = history.pop();
      const targetNodeId = previousNodeId || flow.entryNode;
      const backNode = this._getNode(compiled, flow, targetNodeId);
      if (!backNode) return null;
      return this.processNode(
        userId,
        backNode,
        compiled,
        flow,
        session?.variables || {},
        session,
        '',
        flowMode,
        perfContext,
        { skipHistoryPush: true, historyOverride: history }
      );
    }

    if (globalCommand === 'human') {
      const humanNodeId = this._resolveHumanNodeId(compiled, flow);
      if (humanNodeId) {
        const node = this._getNode(compiled, flow, humanNodeId);
        if (node) {
          return this.processNode(
            userId,
            node,
            compiled,
            flow,
            session?.variables || {},
            session,
            '',
            flowMode,
            perfContext,
            { skipHistoryPush: true }
          );
        }
      }
      await conversationExportService.exportFinalizedConversation(
        userId,
        'human_handoff',
        {
          flowId: flow.id,
          flowVersion: flow.version,
          reason: 'human_handoff',
          lastNodeId: session?.currentNode || null,
          requiresHuman: true,
        },
        perfContext
      );
      await sessionService.resetSession(userId, perfContext);
      return {
        reply: '🙌 Te vamos a derivar con una persona del equipo para que pueda ayudarte mejor.',
        flowId: flow.id,
        currentNodeId: null,
        variables: {},
      };
    }
    return null;
  }

  _resolveHumanNodeId(compiled, flow) {
    if (compiled?.globalCommandEntryByType?.get('human')) {
      return compiled.globalCommandEntryByType.get('human');
    }
    const candidates = ['human_handoff', 'humano', 'asesor', 'representante'];
    for (const candidate of candidates) {
      if (this._getNode(compiled, flow, candidate)) return candidate;
    }
    return null;
  }

  _getNode(compiled, flow, nodeId) {
    if (!nodeId) return null;
    if (compiled?.nodesById?.has(nodeId)) return compiled.nodesById.get(nodeId);
    return flow.nodes.find((n) => n.id === nodeId) || null;
  }

  _transitionStats(node) {
    const transitions = Array.isArray(node?.transitions) ? node.transitions : [];
    let valueCount = 0;
    for (const trans of transitions) {
      const value = trans?.value;
      if (Array.isArray(value)) valueCount += value.length;
      else if (typeof value === 'string') valueCount += 1;
    }
    return {
      transitionCount: transitions.length,
      valueCount,
    };
  }

  _isInformationalResolutionNode(node) {
    if (!node || node.type !== 'message') return false;
    if (node.isInformational === true) return true;
    if (String(node.exportStatus || '').trim().toLowerCase() === 'info_provided') return true;
    if (String(node.track?.exportStatus || '').trim().toLowerCase() === 'info_provided') return true;
    const message = String(node.message || '');
    return message.includes('✅ *Información solicitada*');
  }
}

const flowEngine = new FlowEngine();
export default flowEngine;
