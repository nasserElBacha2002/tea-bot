# Legacy classic editor — removal audit (Tea-bot frontend)

**Scope:** `frontend/src/features/flows/**` plus `frontend/src/app/router.tsx`.  
**Method:** `rg`/import tracing (February 2026).

---

## Status — removal executed (2026-04-02)

**Phase 0 (blocking gaps — resolved before deletion):**

| Item | Resolution |
|------|------------|
| **0.1** Flow name / description | **Migrated:** `UPDATE_FLOW_INFO` en `conversationEditorReducer`, `updateFlowInfo` en `useConversationEditor`, UI **`FlowMetadataDialog`** + botón **Datos** en `ConversationEditorPage`. |
| **0.2** Backend `validate` en UI | **Migrated:** botón **Validar** en `ConversationEditorPage` usando `useValidateFlow` + `buildSavePayload(remoteFlow)`. |
| **0.3** JSON inspect de versiones | **Intentionally dropped:** el historial en conversación sigue legible y sin JSON por defecto; sin diálogo “Ver JSON” de `FlowVersionsPanel`. Recuperable como follow-up si producto lo pide. |

**Phases 1–4:** aplicadas en código (redirect, borrado de `FlowEditorPage` y componentes solo-clásicos, `useFlowGraph.ts`, poda de `flowGraph.layout.ts` y exports muertos en `ops` / `mapper` / `validation`). **Phase 5:** no refactor amplio del grafo; mapa sigue read-only.

El texto siguiente del audit se conserva como **registro histórico** del análisis previo a la eliminación.

---

## A. Executive summary (historical)

- **Single canonical editor:** `ConversationEditorPage` at **`/flows/:flowId/conversation`** — it already owns save (`useUpdateFlow`), publish (`useConversationPublish` → `usePublishFlow`), simulator (`SimulatorPanel` + `useConversationSimulator` + `simulatorApi`), historial (`HistoryTimeline` + `useConversationHistory` → same version APIs as the classic panel), and map (`AdvancedMapView` → `FlowGraphCanvas` **`readOnly`**).
- **Classic editor (removed):** `FlowEditorPage` and dependent panels were the **sole** consumers of graph-first editing shell, `FlowVersionsPanel`, `FlowSimulatorPanel`, `FlowEdgeEditorPanel`, inline `NodeForm`, etc.
- **Former gaps (addressed 2026-04-02):** metadata editing and server validate re-homed to conversation editor; JSON inspect not migrated by choice.
- **Risks mitigated:** `/flows/:id` redirects; shared graph utilities retained for read-only map.

---

## B. Canonical route decision

| Route | Recommendation | Evidence |
|--------|------------------|----------|
| **`/flows/:flowId/conversation`** | **Keep** as the **only** full editor experience | `router.tsx` line 14; all new navigation from `FlowListPage` / create flow targets this. |
| **`/flows/:flowId`** | **Redirect** to **`/flows/:flowId/conversation`** (replace) | Today renders `FlowEditorPage` (`router.tsx` line 15). Many users/bookmarks may still use the short URL. |
| **`/flows`** | **Keep** | `FlowListPage` — list, create, publish shortcut, duplicate, archive. |

**Delete:** no standalone “classic-only” route is required once redirect is in place; **`FlowEditorPage` becomes deletable** as a component after redirects and migrations.

**Optional:** `Navigate` from `/flows/:flowId` with `replace` preserves UX; logging/metrics can confirm traffic drop on classic.

---

## C. Inventory table

**Legend — classification**

- **SAFE TO DELETE** — No remaining importers after removing `FlowEditorPage` and cleaning dependents (verified by grep).
- **REUSED BY NEW EDITOR** — Imported (directly or transitively) from `editor/**` or shared pages/hooks still needed.
- **NEEDS MIGRATION BEFORE DELETE** — Capability exists only in classic UI or only classic uses server/API path; must be re-homed or explicitly dropped.

### C.1 Routing & shells

| File / module | Type | Current status | Evidence | Classification | Notes |
|---------------|------|----------------|----------|------------------|-------|
| `app/router.tsx` | routes | Registers both editors | Imports `FlowEditorPage` + `ConversationEditorPage` | **NEEDS MIGRATION** | Replace `/flows/:flowId` with redirect. |
| `pages/FlowEditorPage.tsx` | page | Classic only | Imported only from `router.tsx` | **SAFE TO DELETE** (after migration) | ~677 lines; contains inline `NodeForm`, `TransitionEditor`, tabs. |
| `pages/FlowListPage.tsx` | page | Shared | Default “Editar” → conversation; secondary `RouterLink` to `/flows/:id` (BubbleChart) | **REUSED** + **cleanup** | Remove classic CTA when product confirms single editor. |
| `editor/ConversationEditorPage.tsx` | page | New editor | Self-contained | **REUSED** | “Vista clásica” link to `/flows/:id` — remove after redirect/delete. |

### C.2 Classic-only components (`features/flows/components/`)

| File / module | Type | Evidence importers | Classification | Notes |
|---------------|------|--------------------|------------------|-------|
| `FlowEdgeEditorPanel.tsx` | component | **Only** `FlowEditorPage.tsx` | **SAFE TO DELETE** | Graph edge / transition editing UI. |
| `FlowVersionsPanel.tsx` | component | **Only** `FlowEditorPage.tsx` | **SAFE TO DELETE** (or **migrate**) | Uses `usePublishedVersions`, `usePublishedVersionDetail`, `useDuplicatePublishedToDraft`. Conversation uses **`HistoryTimeline`** + **`RestoreDraftDialog`** instead. **JSON viewer** in dialog is **not** in conversation historial — migrate if still needed. |
| `FlowSimulatorPanel.tsx` | component | **Only** `FlowEditorPage.tsx` | **SAFE TO DELETE** | Conversation uses `editor/components/SimulatorPanel.tsx` + `useConversationSimulator` + same `simulatorApi`. |
| `FlowGraphCanvas.tsx` | component | `FlowEditorPage.tsx`, `AdvancedMapView.tsx`, test mock | **REUSED BY NEW EDITOR** | Map + any future editable graph. |
| `FlowGraphNode.tsx` | component | `FlowGraphCanvas.tsx` only | **REUSED BY NEW EDITOR** (transitive) | |
| `FlowGraphToolbar.tsx` | component | `FlowGraphCanvas.tsx` | **REUSED** (hidden when `readOnly`) | |
| `FlowConnectTransitionDialog.tsx` | component | `FlowGraphCanvas.tsx` | **REUSED** (unused at runtime when `readOnly`, still bundled) | Could slim canvas for map-only later — optional refactor. |

### C.3 Hooks & API

| File / module | Type | Evidence | Classification | Notes |
|---------------|------|----------|------------------|-------|
| `hooks/useFlows.ts` | hooks | `FlowListPage`, `FlowEditorPage`, `ConversationEditorPage`, `useConversationPublish`, `useConversationHistory` | **REUSED** | Do not remove. |
| `hooks/useFlowGraph.ts` | barrel re-exports | **No** `import` of `useFlowGraph` anywhere under `src/` | **SAFE TO DELETE** | Dead file; nothing references it. |
| `useValidateFlow` (in `useFlows.ts`) | hook | **Only** `FlowEditorPage.tsx` | **NEEDS MIGRATION** or **orphan export** | Expose “Validar” in conversation editor or drop feature explicitly. |
| `usePublishFlow` | hook | `FlowEditorPage`, `FlowListPage`, `useConversationPublish` | **REUSED** | |
| `useUpdateFlow` / `useFlow` | hooks | Both editors + tests | **REUSED** | |
| `api/flowsApi.ts` | API client | Broad | **REUSED** | |
| `api/simulatorApi.ts` | API client | `FlowSimulatorPanel`, `useConversationSimulator` | **REUSED** | After classic removal, only conversation path + tests. |

### C.4 Graph utilities

| File / module | Used by (after classic removed) | Classification | Notes |
|---------------|---------------------------------|----------------|-------|
| `utils/flowGraph.mapper.ts` | `FlowGraphCanvas`, `FlowGraphNode`, `flowGraph.validation` (`getNodeIssues`) | **REUSED** | `createBlankNode` / `createNodeOfType` — **only** `FlowEditorPage` today → **dead code paths** once page deleted; safe to delete **those exports** if unused. |
| `utils/flowGraph.ops.ts` | `appendTransitionToNode` ← `FlowGraphCanvas`; `duplicateNodeInFlow` ← only classic; `updateTransitionInFlow` / `removeTransitionFromFlow` ← only `FlowEdgeEditorPanel` | **Partial reuse** | After deleting classic + edge panel, **trim** unused exports or keep for future editable map. |
| `utils/flowGraph.layout.ts` | `organizeFlowGrid` ← only `FlowEditorPage`; `organizeFlowSequential` ← **nothing** (only via dead `useFlowGraph`) | **SAFE TO DELETE** *if* map stays read-only and toolbar never calls organize | Today `AdvancedMapView` passes noop `onOrganizeLayout`. |
| `utils/flowGraph.validation.ts` | `getNodeIssues` ← mapper/graph; `getFlowLevelIssues` / `countReferencesToNode` ← **only** `FlowEditorPage` | **Partial reuse** | Prune editor-only helpers after page removal **if** not wanted elsewhere. |
| `utils/flowUiLabels.ts` | `flowStatusLabel` ← `FlowListPage`; `UI_*` ← graph components | **REUSED** | |

### C.5 Conversation editor (keep)

All under `editor/**` (components, `model/*`, `state/*`) except any future dead code — **REUSED** as the primary product. Not listed exhaustively; they are **not** legacy.

### C.6 Tests & docs

| Artifact | Classification | Notes |
|----------|----------------|-------|
| `MoreToolsPanel.test.tsx` | **REUSED** | Mocks `FlowGraphCanvas`. |
| `ConversationEditorPage.test.tsx` | **REUSED** | Update if routes change. |
| `docs/EDITOR_ARCHITECTURE.md`, `IMPLEMNTATION_PLAN.md` | **Update after removal** | Still describe dual editor / classic links. |

---

## D. Deletion plan (phased)

1. **Migrate or explicitly drop capabilities**
   - Flow **name / description** editing in conversation UI (or document that only API/list handles renames).
   - Optional: **Server validate** (`useValidateFlow`) from conversation toolbar.
   - Optional: **Published version JSON inspect** — add behind “Detalle avanzado” in `HistoryTimeline` if still required.

2. **Redirect legacy route**
   - `router.tsx`: `/flows/:flowId` → `<Navigate to={/flows/${flowId}/conversation} replace />` (or dedicated tiny component).

3. **Remove legacy entry points & CTAs**
   - `FlowListPage`: remove secondary link to `/flows/:id`.
   - `ConversationEditorPage`: remove “Vista clásica” button.

4. **Delete classic page and classic-only components**
   - `FlowEditorPage.tsx`
   - `FlowEdgeEditorPanel.tsx`, `FlowVersionsPanel.tsx`, `FlowSimulatorPanel.tsx`

5. **Prune graph utilities & dead barrels**
   - `hooks/useFlowGraph.ts`
   - Unused exports in `flowGraph.ops.ts`, `flowGraph.layout.ts`, `flowGraph.mapper.ts`, `flowGraph.validation.ts` (verify with `rg` after each deletion).
   - Consider slimming `FlowGraphCanvas` for read-only-only build (optional, larger refactor).

6. **Final cleanup**
   - `useValidateFlow`: remove from `useFlows.ts` if nothing calls it, or wire to conversation.
   - Tests/docs: update `EDITOR_ARCHITECTURE.md`, implementation plan, any screenshots.
   - Run `npm run test`, `npm run build`, `npm run lint`.

---

## E. Risk checklist (pre-merge)

- [ ] **Save:** `useUpdateFlow` from `ConversationEditorPage` still works.
- [ ] **Publish:** `useConversationPublish` → `usePublishFlow` unchanged.
- [ ] **Simulator:** `SimulatorPanel` + `useConversationSimulator` + `simulatorApi` smoke-tested.
- [ ] **Historial / restore:** `HistoryTimeline` + `duplicatePublishedToDraft` + post-restore `hydrateFromServer` path.
- [ ] **Map:** `Más herramientas` → Mapa → `AdvancedMapView` → `FlowGraphCanvas` `readOnly`.
- [ ] **Bookmarks:** `/flows/:id` redirects to conversation.
- [ ] **Flow metadata:** name/description policy documented and implemented if needed.
- [ ] **No broken imports:** full TypeScript build + tests.
- [ ] **List actions:** create/publish/duplicate/archive on `FlowListPage` still valid.

---

## F. Confidence & open questions

| Area | Confidence | Open question |
|------|------------|----------------|
| `FlowEditorPage` is the only classic shell | **High** | — |
| Graph canvas stack required for map | **High** | Future editable map may need `FlowEdgeEditorPanel` or equivalent — product call. |
| `useFlowGraph.ts` is dead | **High** | Safe delete anytime. |
| `organizeFlowGrid` / `duplicateNodeInFlow` unused after classic removal | **High** (verify after delete) | Keep if you plan “organize” in map toolbar later. |
| Whether to keep backend **validate** in UI | **Medium** | Ask backend/product. |
| Whether **JSON** version inspect is required | **Medium** | Only in `FlowVersionsPanel` today. |

---

*End of audit.*
