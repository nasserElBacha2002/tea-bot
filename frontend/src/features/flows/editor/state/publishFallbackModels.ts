import type { Flow } from '../../types/flow.types';
import type { ConversationViewModel } from '../model/conversationViewModel';

/** Placeholder solo para montar hooks antes de que llegue el borrador (no se usa para publicar real). */
export const EMPTY_PUBLISH_FLOW: Flow = {
  id: '__loading__',
  name: '',
  version: 'draft',
  status: 'draft',
  entryNode: '_',
  fallbackNode: '_',
  nodes: [],
};

export const EMPTY_PUBLISH_VM: ConversationViewModel = {
  flowId: '__loading__',
  flowName: '',
  version: 'draft',
  status: 'draft',
  entryStepId: '_',
  fallbackStepId: '_',
  steps: [],
  compatibilityWarnings: [],
};
