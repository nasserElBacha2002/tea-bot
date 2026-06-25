import type { ConversationStep } from './conversationViewModel';

export type StepPathSection = 'path' | 'orphan';

export interface StepPathDisplayItem {
  step: ConversationStep;
  /** Indentation depth from entry (0 = entry). */
  depth: number;
  /** Stable group id for branch coloring; orphans use -1. */
  branchGroup: number;
  /** 1-based journey order in the sidebar. */
  pathOrder: number;
  section: StepPathSection;
}

function compareResponseOrder(a: ConversationStep['responses'][0], b: ConversationStep['responses'][0]): number {
  const pa = a.enginePriority ?? Number.MAX_SAFE_INTEGER;
  const pb = b.enginePriority ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return a.displayOrder - b.displayOrder;
}

/** Outgoing step ids in deterministic traversal order. */
export function getStepOutgoingTargets(step: ConversationStep): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();

  const add = (id: string | undefined | null) => {
    const normalized = String(id ?? '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    targets.push(normalized);
  };

  add(step.metadata.messageAutoAdvanceNextNode);

  const responses = [...step.responses].sort(compareResponseOrder);
  for (const response of responses) {
    add(response.destinationStepId);
  }

  for (const transition of step.metadata.preservedTransitions ?? []) {
    add(transition.nextNode);
  }

  add(step.metadata.parallelNextNode);

  return targets;
}

/**
 * Builds sidebar display order by traversing the flow graph from the entry step.
 * Unreachable steps are appended in a separate orphan section (stable id sort).
 */
export function buildStepPathDisplayOrder(
  steps: ConversationStep[],
  entryStepId: string,
): StepPathDisplayItem[] {
  const byId = new Map(steps.map(step => [step.internalId, step]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: StepPathDisplayItem[] = [];
  let pathOrder = 0;
  let branchGroupSeq = 0;

  const allocateBranchGroup = () => {
    const id = branchGroupSeq;
    branchGroupSeq += 1;
    return id;
  };

  const visit = (stepId: string, depth: number, branchGroup: number) => {
    if (!byId.has(stepId) || visited.has(stepId)) return;
    if (visiting.has(stepId)) return;

    visiting.add(stepId);
    const step = byId.get(stepId)!;
    visited.add(stepId);
    visiting.delete(stepId);

    pathOrder += 1;
    result.push({
      step,
      depth,
      branchGroup,
      pathOrder,
      section: 'path',
    });

    const children = getStepOutgoingTargets(step).filter(id => byId.has(id));
    children.forEach(childId => {
      const childBranchGroup = children.length > 1 ? allocateBranchGroup() : branchGroup;
      visit(childId, depth + 1, childBranchGroup);
    });
  };

  const normalizedEntry = String(entryStepId ?? '').trim();
  if (normalizedEntry && byId.has(normalizedEntry)) {
    visit(normalizedEntry, 0, 0);
  }

  const orphans = steps
    .filter(step => !visited.has(step.internalId))
    .sort((a, b) => a.internalId.localeCompare(b.internalId));

  for (const step of orphans) {
    pathOrder += 1;
    result.push({
      step,
      depth: 0,
      branchGroup: -1,
      pathOrder,
      section: 'orphan',
    });
  }

  return result;
}

/** Soft palette for branch accents (low saturation). */
const BRANCH_STYLES = [
  { border: 'rgba(25, 118, 210, 0.35)', bg: 'rgba(25, 118, 210, 0.05)' },
  { border: 'rgba(46, 125, 50, 0.32)', bg: 'rgba(46, 125, 50, 0.05)' },
  { border: 'rgba(123, 31, 162, 0.3)', bg: 'rgba(123, 31, 162, 0.05)' },
  { border: 'rgba(237, 108, 2, 0.32)', bg: 'rgba(237, 108, 2, 0.05)' },
  { border: 'rgba(0, 131, 143, 0.32)', bg: 'rgba(0, 131, 143, 0.05)' },
  { border: 'rgba(94, 53, 177, 0.3)', bg: 'rgba(94, 53, 177, 0.05)' },
] as const;

export function getStepPathRowSx(
  item: Pick<StepPathDisplayItem, 'depth' | 'branchGroup' | 'section'>,
  selected: boolean,
) {
  const indentPx = 8 + item.depth * 12;

  if (selected) {
    return {
      pl: `${indentPx}px`,
      borderLeft: '2px solid',
      borderColor: 'primary.main',
    };
  }

  if (item.section === 'orphan') {
    return {
      pl: `${indentPx}px`,
      borderLeft: '2px dashed',
      borderColor: 'divider',
      bgcolor: 'action.hover',
      opacity: 0.92,
    };
  }

  if (item.depth === 0 && item.branchGroup === 0) {
    return {
      pl: `${indentPx}px`,
      borderLeft: '2px solid',
      borderColor: 'divider',
    };
  }

  const palette = BRANCH_STYLES[Math.abs(item.branchGroup) % BRANCH_STYLES.length];
  return {
    pl: `${indentPx}px`,
    borderLeft: '2px solid',
    borderColor: palette.border,
    bgcolor: palette.bg,
  };
}
