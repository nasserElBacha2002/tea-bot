# Informe técnico: clasificación de Consulta principal

**Estado final:** `IMPLEMENTED_WITH_LIMITATIONS`

**Fecha:** 2026-07-27

---

## A. Resumen

Se implementó una arquitectura separada para clasificar conversaciones antes de exportarlas a Google Sheets, corrigiendo el problema estructural por el cual `Consulta principal` quedaba en `"No informado"` para la mayoría de rutas `no_*`.

**Comportamiento legacy (default):** `CONVERSATION_CLASSIFICATION_MODE=legacy` — el Sheet sigue exportando la heurística anterior (`inferConsultaPrincipal`), pero el clasificador v2 se ejecuta, persiste (si hay DB) y registra logs/métricas cuando corresponde.

**Comportamiento nuevo:** modos `shadow` (export legacy + diff) y `enabled` (export v2). Actualización idempotente del Sheet controlada por `CONVERSATION_CLASSIFICATION_SHEET_UPDATE_ENABLED`.

---

## B. Archivos modificados

| Archivo | Cambio | Motivo | Riesgo |
|---------|--------|--------|--------|
| `migrations/006_conversation_classification.sql` | Tablas/columnas de clasificación, export index, tracking | Persistencia e idempotencia | Bajo — migración idempotente |
| `src/services/conversationClassification/*` | Módulo completo (rules, resolver, text, persistence, metrics, logging) | Separación de responsabilidades | Medio — reglas deben validarse en prod |
| `src/services/conversationExport.service.js` | Pipeline clasificación + export idempotente | Integración end-to-end | Medio |
| `src/services/conversationSheetFormatter.service.js` | Columnas extendidas + Conversation ID | Trazabilidad Sheet | Bajo — headers retrocompatibles vía `ensureHeaderColumns` |
| `src/services/conversationSheetExport.service.js` | Append/update por `conversationId` | Evitar duplicados | Medio hasta activar flag |
| `src/services/conversationSheetSync.service.js` | Sync clasificación + email | Updates posteriores | Medio |
| `src/services/conversation.service.js` | Persistencia `tracking_json` | Recuperación post-reinicio | Bajo |
| `src/services/googleSheets.service.js` | `updateRowRange`, `updatedRange` real | Row number confiable | Bajo |
| `src/config.js`, `.env.example` | Feature flags | Rollout incremental | Bajo |
| `scripts/reconcile-*.js` | Reconciliación y rollback | Histórico controlado | Alto si se aplica sin dry-run |
| Tests `*.test.js` | Cobertura resolver, rules, text | Regresión | Bajo |

---

## C. Migraciones

Ejecutar:

```bash
npm run db:migrate
```

**Nuevas estructuras:**
- `conversation_sessions.tracking_json`
- `conversation_classifications` (índice único activo por conversación)
- `conversation_sheet_exports` (idempotency key + row number)
- `conversation_classification_batches`

**Rollback DB:** no destructivo; desactivar flags vuelve a export legacy. Tablas pueden conservarse.

---

## D. Reglas

- **Versión clasificador:** `v2.0.0`
- **Prioridad:** manual > explicit_track > node_route > transition_trail > message_rules > legacy > fallback
- **Nodos genéricos ignorados:** welcome, human_handoff, collect_email, si_menu, no_menu, etc.
- **Acumulación:** múltiples patrones por nodo (ej. `no_pd_informes` → PD + informes)
- **Texto libre:** deshabilitado por default (`CONVERSATION_CLASSIFICATION_TEXT_RULES_ENABLED=false`)
- **Flujo soportado:** `main-menu` default rules (v11 node ids, paridad `no_*` / `si_*`)

---

## E. Google Sheets

- **Append:** conversación sin registro en `conversation_sheet_exports`
- **Update:** cuando `CONVERSATION_CLASSIFICATION_SHEET_UPDATE_ENABLED=true` y existe row number
- **Identificación:** columna `Conversation ID` + índice DB
- **Columnas administradas:** Consulta principal, Detalle, Modalidad, Programa, Motivo, Área, Fuente, Confianza, Email (no Observaciones)
- **Duplicados:** mitigados por idempotency key; legacy sin flag mantiene comportamiento previo (append por sesión)

---

## F. Reconciliación

```bash
# Dry-run (default)
npm run classifications:reconcile

# Aplicar (requiere CONVERSATION_CLASSIFICATION_RECONCILIATION_ENABLED=true)
npm run classifications:reconcile:apply

# Rollback de batch aplicado
node scripts/rollback-conversation-classifications.js --batch-id classification-reconcile-YYYY-MM-DD --apply
```

Salida de revisión: `data/reconciliation/<batch>-dry-run.json`

**Limitación:** rollback de Sheet requiere backup de celdas en el JSON del batch (pendiente enriquecer en apply).

---

## G. Tests

168 tests pasando (`npm test`), incluyendo:
- Resolver (manual, node_route, fallback, modos export)
- Rules (paths `no_*` / `si_*`, nodos genéricos)
- Text rules (saludos, aranceles, inscripción, negaciones)
- Formatter (23 columnas), export, tracker

---

## H. Métricas

Eventos JSON:
- `conversation_primary_query_classified`
- `conversation_sheet_sync`

Contadores in-memory en `classificationMetrics.service.js` (total, fallback, by source, sheet append/update).

**Baseline shadow:** activar `CONVERSATION_CLASSIFICATION_MODE=shadow` y comparar `legacyResult` vs `result` en logs.

---

## I. Riesgos pendientes

1. **`track` explícito en flujo DB:** no agregado a transiciones v11/v28 — mapping por nodos es la fuente principal
2. **Validación en producción:** no ejecutada sobre muestra real anonimizada en este entorno
3. **Reconciliación histórica:** dry-run implementado; apply requiere revisión humana
4. **Rollback Sheet:** backup por celda incompleto en apply path
5. **Filas legacy sin Conversation ID:** dependen de match teléfono+fecha hasta backfill

---

## J. Rollout recomendado

| Etapa | Flags |
|-------|-------|
| A — Instrumentación | `MODE=shadow`, logging/metrics ON |
| B — Determinístico | `MODE=enabled`, text OFF |
| C — Texto | `TEXT_RULES_ENABLED=true` tras revisar shadow |
| D — Sheet update | `SHEET_UPDATE_ENABLED=true` en lote piloto |
| E — Histórico | `RECONCILIATION_ENABLED=true`, dry-run → apply |

**Criterio para `enabled` en prod:** reducción medible de `No informado` incorrecto, 0 duplicados nuevos, tests verdes, rehidratación validada.
