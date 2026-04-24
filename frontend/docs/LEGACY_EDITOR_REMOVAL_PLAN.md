# Legacy classic editor — concrete removal sequence

**Executed in repo:** 2026-04-02 (Phases 0–4 + doc updates; Phase 5 skipped as optional refactor).

This document turns **`LEGACY_EDITOR_REMOVAL_AUDIT.md`** into an ordered checklist. **Do not start phase 2 until phase 0 is done** (metadata / validate / JSON decisions).

---

## Phase 0 — Product & parity (blocking)

| Step | Action | Owner hint |
|------|--------|------------|
| 0.1 | Decide how **flow name** and **description** are edited without the classic Formulario tab (new fields in conversation header, settings drawer, or list-only). | Product + FE |
| 0.2 | Decide if **`flowsApi.validate`** must remain exposed in UI; if yes, add a control on `ConversationEditorPage` using `useValidateFlow`. | Product + BE |
| 0.3 | Decide if **JSON inspect** for a published version is still needed; if yes, extend `HistoryTimeline` or add an advanced dialog (conversation historial currently avoids raw JSON by design). | Product |

**Exit criteria:** Written decision for 0.1–0.3 (even if “not needed”).

---

## Phase 1 — Route & navigation (low risk)

1. **`frontend/src/app/router.tsx`**
   - Remove `import { FlowEditorPage } ...`.
   - Replace `<Route path="/flows/:flowId" element={<FlowEditorPage />} />` with a redirect, e.g. a one-line wrapper component using `useParams()` + `<Navigate to={\`/flows/${flowId}/conversation\`} replace />`, or an equivalent `Navigate` pattern that preserves `flowId`.

2. **`frontend/src/features/flows/pages/FlowListPage.tsx`**
   - Remove the secondary **BubbleChart** `IconButton` linking to `/flows/${f.id}`.
   - Ensure primary **Editar** stays `to={/flows/${f.id}/conversation}`.

3. **`frontend/src/features/flows/editor/ConversationEditorPage.tsx`**
   - Remove the **“Vista clásica”** `RouterLink` to `/flows/${flowId}`.

4. **Manual test:** open `/flows/<id>` in browser → lands on conversation editor.

---

## Phase 2 — Delete classic page & exclusive components

Delete these files (verify `rg` has no imports first):

| # | Path |
|---|------|
| 1 | `src/features/flows/pages/FlowEditorPage.tsx` |
| 2 | `src/features/flows/components/FlowEdgeEditorPanel.tsx` |
| 3 | `src/features/flows/components/FlowVersionsPanel.tsx` |
| 4 | `src/features/flows/components/FlowSimulatorPanel.tsx` |

Then run:

```bash
cd frontend && npm run build && npm run test && npm run lint
```

Fix any broken imports (there should be none outside `router.tsx` if audit is current).

---

## Phase 3 — Remove confirmed-dead barrel

| # | Path |
|---|------|
| 1 | `src/features/flows/hooks/useFlowGraph.ts` |

Re-run build/test.

---

## Phase 4 — Prune unused graph helpers (incremental)

After phase 2, re-run ripgrep for each symbol; **delete only what has zero references**.

Suggested order (safest first):

1. **`flowGraph.layout.ts`**
   - If `organizeFlowGrid` and `organizeFlowSequential` have **no** importers, remove them (or delete file if empty).

2. **`flowGraph.mapper.ts`**
   - Remove `createBlankNode` / `createNodeOfType` if unused.

3. **`flowGraph.ops.ts`**
   - Remove `duplicateNodeInFlow` if unused.
   - Remove `updateTransitionInFlow` / `removeTransitionFromFlow` if unused (they were only used by `FlowEdgeEditorPanel`).

4. **`flowGraph.validation.ts`**
   - Remove `getFlowLevelIssues` / `countReferencesToNode` if unused.

5. **`useFlows.ts`**
   - Remove `useValidateFlow` export **only if** no component calls it after phase 0.2.

**Stop condition:** `npm run build` green after each batch.

---

## Phase 5 — Optional: slim `FlowGraphCanvas` for read-only-only

**Only if** product commits to **no** editable map for the foreseeable future:

- Split or gate code paths so connect dialog, `appendTransitionToNode`, and non-readonly handlers are not required for the map build.
- This is **larger than a deletion task** — treat as a separate refactor; not required to remove the classic editor.

---

## Phase 6 — Documentation

- Update **`docs/EDITOR_ARCHITECTURE.md`**: remove dual-editor narrative; document redirect; document metadata editing location.
- Update **`IMPLEMNTATION_PLAN.md`** (or `IMPLEMENTATION_PLAN.md` if renamed): status section.
- Update **`LEGACY_EDITOR_REMOVAL_AUDIT.md`** header to “Executed on &lt;date&gt;” or archive.

---

## Rollback

- Revert route change + restore `FlowEditorPage` + components from VCS if a release must hotfix classic access.

---

*This plan assumes the audit in `LEGACY_EDITOR_REMOVAL_AUDIT.md` remains accurate; re-run `rg` before phase 4 if other branches added imports.*
