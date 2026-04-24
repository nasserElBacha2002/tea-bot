/**
 * Validador de flujos conversacionales.
 * Verifica la integridad lógica y estructural de los archivos JSON.
 */
class FlowValidator {
  constructor() {
    this.supportedTypes = ['message', 'capture', 'redirect', 'end'];
    this.supportedTransitions = ['match', 'matchAny', 'matchIncludes', 'default'];
  }

  /**
   * Valida un objeto de flujo completo.
   * @param {Object} flow - El flujo cargado desde JSON.
   * @throws {Error} - Si el flujo es inválido.
   */
  validate(flow) {
    const { id, entryNode, fallbackNode, nodes, schemaVersion } = flow;

    // 1. Campos base
    if (!id) throw new Error('El flujo debe tener un "id" único.');
    if (!entryNode) throw new Error(`El flujo "${id}" debe tener un "entryNode" definido.`);
    if (!Array.isArray(nodes)) {
      throw new Error(`El flujo "${id}" debe tener "nodes" como array.`);
    }
    if (nodes.length === 0) {
      throw new Error(`El flujo "${id}" debe tener una lista de "nodes" no vacía.`);
    }
    if (schemaVersion != null && (!Number.isInteger(schemaVersion) || schemaVersion < 1)) {
      throw new Error(`El flujo "${id}" tiene schemaVersion inválido. Debe ser entero >= 1.`);
    }

    // 2. Verificar existencia de nodos de entrada y fallback
    const nodeIds = nodes.map((n) => n.id);
    if (!nodeIds.includes(entryNode)) {
      throw new Error(`El flow "${id}" define un entryNode "${entryNode}" que no existe en la lista de nodos.`);
    }
    if (fallbackNode && !nodeIds.includes(fallbackNode)) {
      throw new Error(`El flow "${id}" define un fallbackNode "${fallbackNode}" que no existe en la lista de nodos.`);
    }

    // 3. Validar cada nodo individualmente
    for (const node of nodes) {
      this.validateNode(node, nodeIds, id);
    }
  }

  /**
   * Valida la estructura de un nodo.
   */
  validateNode(node, allNodeIds, flowId) {
    // Campos extra (p.ej. ui, priority en transiciones) se ignoran; no afectan al runtime.
    const { id, type, message, transitions, nextNode } = node;

    if (!id) throw new Error(`Un nodo en el flujo "${flowId}" no tiene "id".`);
    if (!type || !this.supportedTypes.includes(type)) {
      throw new Error(`El nodo "${id}" tiene un tipo inválido o no soportado: "${type}".`);
    }

    if (!message || typeof message !== 'string') {
      throw new Error(`El nodo "${id}" de tipo "${type}" requiere un campo "message".`);
    }

    // Validar transiciones si existen
    if (transitions) {
      if (!Array.isArray(transitions)) {
        throw new Error(`Las transiciones del nodo "${id}" deben ser un array.`);
      }

      for (const trans of transitions) {
        if (!trans.nextNode) {
          throw new Error(`Una transición en el nodo "${id}" no define "nextNode".`);
        }
        if (!allNodeIds.includes(trans.nextNode)) {
          throw new Error(`El nodo "${id}" apunta a un nextNode inexistente: "${trans.nextNode}".`);
        }
        if (trans.type && !this.supportedTransitions.includes(trans.type)) {
          throw new Error(`El nodo "${id}" tiene una transición con tipo desconocido: "${trans.type}".`);
        }
      }
    }

    // Validar nextNode directo (usado en redirect o message sin opciones)
    if (nextNode && !allNodeIds.includes(nextNode)) {
      throw new Error(`El nodo "${id}" tiene un nextNode directo que no existe: "${nextNode}".`);
    }
  }
}

const flowValidator = new FlowValidator();
export default flowValidator;
