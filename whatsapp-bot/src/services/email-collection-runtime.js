import {
  COLLECT_EMAIL_NODE_ID,
  DEFAULT_INVALID_EMAIL_REPLY,
  WELCOME_NODE_ID,
} from '../constants/contact-email-flow.js';
import { validateContactEmail } from '../utils/contact-email.js';
import { saveContactEmailForConversation } from './contact-email.service.js';

export function isEmailCollectionNode(nodeId) {
  return nodeId === COLLECT_EMAIL_NODE_ID;
}

export function resolveInitialNodeId(flow, hasStoredEmail) {
  if (hasStoredEmail) return WELCOME_NODE_ID;
  return flow.entryNode || COLLECT_EMAIL_NODE_ID;
}

export function invalidEmailReply(collectEmailNode) {
  const fromMeta = collectEmailNode?.metadata?.invalidEmailMessage;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  return DEFAULT_INVALID_EMAIL_REPLY;
}

/**
 * Handles user input while on collect_email.
 * @returns {Promise<null | { reply: string, currentNodeId: string, variables: object, emailSaved: boolean }>}
 */
export async function tryHandleEmailCollectionInput({
  rawText,
  conversation,
  collectEmailNode,
  welcomeNode,
}) {
  if (!collectEmailNode || !welcomeNode) return null;

  const validation = validateContactEmail(rawText);
  if (!validation.valid) {
    return {
      reply: invalidEmailReply(collectEmailNode),
      currentNodeId: COLLECT_EMAIL_NODE_ID,
      variables: {},
      emailSaved: false,
    };
  }

  let email = validation.normalized;
  if (conversation) {
    const saved = await saveContactEmailForConversation(conversation, email);
    email = saved.email;
  }

  return {
    reply: welcomeNode.message,
    currentNodeId: WELCOME_NODE_ID,
    variables: { contact_email: email },
    emailSaved: true,
  };
}

export function shouldBlockGlobalMenuDuringEmailCapture(currentNodeId, hasStoredEmail) {
  return !hasStoredEmail && isEmailCollectionNode(currentNodeId);
}
