# Arquitectura del editor Tea-bot

## Estado actual (único editor de flujos)

### Editor de conversación (`ConversationEditorPage`)

- **Ruta canónica:** **`/flows/:flowId/conversation`** — única experiencia de edición completa.
- **Compatibilidad de URL:** **`/flows/:flowId`** redirige con **`replace`** a la ruta de conversación (`RedirectToConversationEditor` en `app/router.tsx`).
- Lee el mismo `Flow` vía `useFlow`; presenta un **modelo de vista** (`ConversationViewModel`) y persiste con `conversationViewModelToFlow` / `useUpdateFlow`.
- **Metadatos del flujo:** botón **Datos** → `FlowMetadataDialog`; reducer `UPDATE_FLOW_INFO` (`flowName`, `description` opcional).
- **Validación servidor:** botón **Validar** → `useValidateFlow` sobre el borrador serializado (`buildSavePayload`).
- **Simulador:** `SimulatorPanel` + `useConversationSimulator` + `simulatorApi` (borrador actual).
- **Publicación:** `useConversationPublish` → `usePublishFlow`, diálogos de revisión/confirmación.

### Grafo (solo mapa avanzado)

- **`FlowGraphCanvas`** se usa únicamente desde **`AdvancedMapView`** (Más herramientas → Mapa) en modo **`readOnly`**.
- Infraestructura compartida: `flowGraph.mapper.ts` (`flowToGraph`, `applyNodePositions`, …), `flowGraph.validation.ts` (`getNodeIssues` para avisos en nodos), `flowGraph.ops.ts` (`appendTransitionToNode` para el canvas si en el futuro se habilitara edición), `FlowGraphNode`, `FlowConnectTransitionDialog`, `FlowGraphToolbar` (oculto en read-only).

### Capa de modelo de vista

| Archivo | Rol |
|---------|-----|
| `editor/model/conversationViewModel.ts` | Tipos: pasos, respuestas (`exact` / `anyOf` / `fallback`), metadatos para round-trip. |
| `editor/model/conversationAdapters.ts` | `flowToConversationViewModel`, `conversationViewModelToFlow`, `flowsEqualForRoundTrip`. |
| `editor/model/conversationValidation.ts` | `validateConversationViewModel` (validación cliente / UI). |

### Compatibilidad

- `FlowNode.ui.stepTitle` opcional para título legible del paso.
- Transiciones no mapeables → `metadata.preservedTransitions` y reinyección al serializar.
- `message` + `nextNode` sin transiciones → `metadata.messageAutoAdvanceNextNode`.
- `redirect` + `nextNode` → `metadata.parallelNextNode`.

### Nivel 2 — Más herramientas

* **Drawer** derecho: **Conexiones**, **Historial**, **Mapa**.
* **Historial:** `HistoryTimeline` + `usePublishedVersions` / `useDuplicatePublishedToDraft`; sin JSON por defecto en la lista (el inspector JSON de la vista clásica no se migró).
* **Traer a mi borrador:** `RestoreDraftDialog`; tras éxito, `fetchQuery` + `hydrateFromServer`.

### Escalabilidad ligera

* Índice lateral y móvil: búsqueda si hay más de 6 pasos.
* Conexiones: clic en fila → scroll al paso origen.

### Próximos pasos (opcional)

1. Mapa editable con sync bidireccional con el view model.
2. Inspector JSON de versiones publicadas (si producto lo exige).

### Tests

* `npm run test` — adaptadores, editor, publicación, más herramientas, etc.
