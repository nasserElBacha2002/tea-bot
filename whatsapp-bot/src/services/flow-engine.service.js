import flowRepository from '../repositories/flow.repository.js';
import flowLoader from '../utils/flow-loader.js';
import sessionService from './session.service.js';

function normalizeMessage(text) {
  return (text || '').trim().toLowerCase();
}

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
  async resolveIncomingMessage({ userId, text, flowMode = 'published', flowId: explicitFlowId, flowSnapshot }) {
    const input = normalizeMessage(text);
    let session = sessionService.getSession(userId);

    // 1. Manejo de Inicio Automático (Si no hay sesión)
    if (!session) {
      const targetFlowId = explicitFlowId || flowLoader.getDefaultFlowId();
      const useSnapshot =
        flowSnapshot
        && typeof flowSnapshot === 'object'
        && flowSnapshot.id === targetFlowId
        && Array.isArray(flowSnapshot.nodes);
      const flow = useSnapshot ? flowSnapshot : await this.getFlow(targetFlowId, flowMode);

      // Creamos la sesión en el nodo inicial (opcional: borrador en memoria para simulador del editor)
      session = await sessionService.createSession(userId, targetFlowId, flow.entryNode, {
        ...(useSnapshot ? { simulatorFlowOverride: flowSnapshot } : {}),
      });

      const entryNode = flow.nodes.find((n) => n.id === flow.entryNode);
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
        return this.processNode(userId, entryNode, flow, {}, '', flowMode);
      }

      return {
        reply: entryNode.message,
        flowId: session.flowId,
        currentNodeId: session.currentNode,
        variables: session.variables,
      };
    }

    // 2. Cargar flujo y nodo actual de la sesión existente
    const flow = await this.getFlow(session.flowId, flowMode, session);
    let currentNode = flow.nodes.find((n) => n.id === session.currentNode || n.id === session.nodeId);

    if (!currentNode) {
      console.warn(
        `[FlowEngine] Sesión corrupta: nodo "${session.currentNode}" inexistente en "${session.flowId}". Reiniciando conversación.`,
      );
      await sessionService.resetSession(userId);
      return this.resolveIncomingMessage({
        userId,
        text,
        flowMode,
        flowId: explicitFlowId,
        flowSnapshot,
      });
    }

    // 3. Evaluar transiciones según el input del usuario
    const nextNodeId = this.evaluateTransitions(currentNode, input, flow.fallbackNode);
    const nextNode = flow.nodes.find((n) => n.id === nextNodeId);

    // 4. Procesar el siguiente nodo (lógica de tipo de nodo)
    return this.processNode(userId, nextNode, flow, session.variables, input, flowMode);
  }

  /**
   * Resuelve un flujo según el modo solicitado.
   */
  async getFlow(flowId, flowMode, session = null) {
    if (session?.simulatorFlowOverride) {
      return session.simulatorFlowOverride;
    }
    if (flowMode === 'draft') {
      const draft = await flowRepository.getDraft(flowId);
      if (!draft) throw new Error(`[FlowEngine] Draft "${flowId}" no encontrado.`);
      return draft;
    }

    // Por defecto usamos el Loader (que cachea los published)
    const published = flowLoader.getFlow(flowId);
    if (!published) {
      // Intento final desde repo por si el loader no refrescó
      const repoPublished = await flowRepository.getLatestPublished(flowId);
      if (!repoPublished) throw new Error(`[FlowEngine] Published "${flowId}" no encontrado.`);
      return repoPublished;
    }
    return published;
  }

  /**
   * Procesa la lógica específica de cada tipo de nodo y actualiza la sesión.
   */
  async processNode(userId, node, flow, variables = {}, lastInput = '', flowMode = 'published') {
    if (!node) {
      console.warn(`[FlowEngine] processNode: siguiente nodo ausente (userId=${userId}).`);
      await sessionService.resetSession(userId);
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
    });

    // Si es un nodo de tipo 'redirect', saltamos automáticamente al siguiente sin esperar input
    if (node.type === 'redirect' && node.nextNode) {
      const targetNode = flow.nodes.find((n) => n.id === node.nextNode);
      if (!targetNode) {
        console.warn(
          `[FlowEngine] redirect desde "${node.id}" apunta a nodo inexistente "${node.nextNode}".`,
        );
        await sessionService.resetSession(userId);
        return {
          reply:
            'Tuvimos un problema al continuar la conversación. Enviá cualquier mensaje para empezar de nuevo.',
          flowId: flow.id,
          currentNodeId: null,
          variables: {},
        };
      }
      return this.processNode(userId, targetNode, flow, currentVariables, '', flowMode);
    }

    // Si es un mensaje informativo que redirige después de mostrarse (en la PRÓXIMA interacción)
    if (node.type === 'message' && node.nextNode) {
      await sessionService.updateSession(userId, { currentNode: node.nextNode });
    }

    // Si es 'end', finalizamos la lógica (en esta fase reseteamos la sesión)
    if (node.type === 'end') {
      await sessionService.resetSession(userId);
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
    if (!node) {
      return fallbackNodeId;
    }
    if (!node.transitions || node.transitions.length === 0) {
      return node.nextNode || fallbackNodeId;
    }

    // 1. match (Coincidencia exacta)
    const matchTrans = node.transitions.find((t) => t.type === 'match' && input === normalizeMessage(t.value));
    if (matchTrans) return matchTrans.nextNode;

    // 2. matchAny (Cualquiera de la lista)
    const matchAnyTrans = node.transitions.find(
      (t) => t.type === 'matchAny'
        && Array.isArray(t.value)
        && t.value.some((v) => input === normalizeMessage(v)),
    );
    if (matchAnyTrans) return matchAnyTrans.nextNode;

    // 3. matchIncludes (Contiene la palabra)
    const matchIncTrans = node.transitions.find(
      (t) => t.type === 'matchIncludes' && input.includes(normalizeMessage(t.value)),
    );
    if (matchIncTrans) return matchIncTrans.nextNode;

    // 4. default
    const defTrans = node.transitions.find((t) => t.type === 'default' || t.default === true);
    if (defTrans) return defTrans.nextNode;

    return fallbackNodeId || node.id;
  }
}

const flowEngine = new FlowEngine();
export default flowEngine;
