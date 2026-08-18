import flowLoader from '../utils/flow-loader.js';
import { resolveInitialNodeId } from './email-collection-runtime.js';
import { getStoredContactEmail, resolveContactEmail } from './contact-email.service.js';

export class FlowEntryNodeResolutionError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, flowId?: string, conversationId?: string }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = 'FlowEntryNodeResolutionError';
    this.flowId = meta.flowId;
    this.conversationId = meta.conversationId;
    if (meta.cause) {
      this.cause = meta.cause;
    }
  }
}

/**
 * Misma policy de entry node que usa FlowEngine al iniciar sesión.
 * @param {object | null | undefined} conversation
 */
export async function resolveFlowEntryNodeForConversation(conversation) {
  const flowId = conversation?.currentFlowId || flowLoader.getDefaultFlowId?.() || 'main-menu';

  let flow;
  try {
    flow = await flowLoader.getFlow(flowId);
  } catch (cause) {
    throw new FlowEntryNodeResolutionError(`No se pudo cargar el flow "${flowId}"`, {
      cause,
      flowId,
      conversationId: conversation?.id,
    });
  }

  if (!flow || typeof flow !== 'object') {
    throw new FlowEntryNodeResolutionError(`Flow "${flowId}" no disponible`, {
      flowId,
      conversationId: conversation?.id,
    });
  }

  let hasStoredEmail = Boolean(getStoredContactEmail(conversation));
  if (!hasStoredEmail) {
    const resolvedEmail = await resolveContactEmail(conversation);
    hasStoredEmail = Boolean(resolvedEmail);
  }

  return resolveInitialNodeId(flow, hasStoredEmail);
}

/** Alias semántico para reentrada post-handoff. */
export const resolveResumeNodeKey = resolveFlowEntryNodeForConversation;
