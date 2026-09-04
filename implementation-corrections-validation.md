# Validación de correcciones — Retención + First Contact

## Estado final

`IMPLEMENTED`

## Root cause de cada corrección

| Hallazgo | Causa | Fix |
| --- | --- | --- |
| TOCTOU SELECT→DELETE | Elegibilidad y borrado eran dos operaciones; el DELETE solo filtraba por id | `deleteInactiveBatchBefore(cutoff, limit)`: CTE + DELETE con el mismo predicado de cutoff |
| unhandledRejection del job | `void runSweep()` + `throw` | `runScheduledSweep()` captura; `runSweep()` sigue propagando |
| Runtime session huérfana | `resetSession` fallaba y se ignoraba | Cola `pendingRuntimeCleanup` + retry; inbound resetea leftover si crea Conversation nueva |
| Batch size 1000 vs cap 500 | Config y repo con máximos distintos; loop `>= batchSize` | `clampRetentionBatchSize` único (max 500); loop hasta batch vacío |
| parsePositiveInt muerto | Helper no usado por config | Config usa `parsePositiveInt` / `clampRetentionBatchSize` |
| Cascades incompletos / SKIP | Fixture parcial y SQL no ejecutado | Fixture con 5 hijos + audit_logs; corrido contra SQL Server real |
| First contact concurrente | Dedupe SID ≠ dos mensajes distintos | `withInboundUserLock` en el pipeline inbound (no en FlowEngine) |
| E2E del bug original | Tests de piezas, no persistencia+engine | `processCanonicalTwilioInbound` con hydrate real |

## Decisiones de concurrencia

**Retención vs inbound `touchLastMessage`:** un solo statement SQL con
`UPDLOCK, READPAST, ROWLOCK` y `WHERE` de cutoff en el DELETE.

- Si inbound ya commiteó `last_message_at = NOW`, la fila no matchea y no se borra.
- Si inbound tiene la fila locked, `READPAST` la saltea en este sweep (no se borra actividad en curso).
- Multi-instancia: no hay lease. Dos jobs pueden barrer; el predicado de cutoff hace idempotente el DELETE. No se introdujo distributed locking.

**First contact:** lock in-process por `userId` alrededor de
persistencia + engine + outbound. No es lock distribuido. Dos instancias
podrían inicializar en paralelo; Conversation sigue siendo unique por
`(channel, external_user_id)` y `currentNodeKey` es la señal de flujo
presentado. Documentado en `inbound-user-lock.js`.

## Estrategia SQL

```sql
WITH stale AS (
  SELECT TOP (@limit) id
  FROM dbo.conversations WITH (UPDLOCK, READPAST, ROWLOCK)
  WHERE last_message_at < @cutoff
     OR (last_message_at IS NULL AND started_at < @cutoff)
  ORDER BY COALESCE(last_message_at, started_at) ASC
)
DELETE c
OUTPUT DELETED.id, DELETED.external_user_id
FROM dbo.conversations c
INNER JOIN stale s ON s.id = c.id
WHERE last_message_at < @cutoff
   OR (last_message_at IS NULL AND started_at < @cutoff)
```

Índice verificado en schema real: `idx_conversations_last_message_at`.
No se creó migración.

`deleteByIds` queda solo para cleanup de tests/seed, no para el job.

## Estrategia de cleanup runtime

1. Tras `sql_deleted`, `resetSession(externalUserId)`.
2. Si falla: `runtime_cleanup_failed`, queda en `pendingRuntimeCleanup`.
3. El job no se reporta como limpio (`job_finished_with_runtime_cleanup_failed`).
4. El próximo sweep reintenta el pending.
5. Recuperación inbound: al crear una Conversation nueva se resetea cualquier
   sesión runtime leftover del mismo `externalUserId`.

No hay transacción distribuida. Idempotente.

## FIRST_CONTACT (sin cambios de semántica)

```text
flowPresented ⇔ currentNodeKey persistido
```

Return-to-bot con resume node no es first contact.
Assigned / waiting_human no reinician el bot.

## Tests ejecutados

Comando real (`whatsapp-bot/package.json`):

```bash
npm test
# node --test $(find src -name '*.test.js' | tr '\n' ' ')
```

Resultado:

```text
# tests 225
# pass 225
# fail 0
# skipped 0
```

Incluye:

* retención 31/29/cutoff/NULL
* race: last_message_at refrescado → no delete (unit + SQL)
* batch 1200 filas / tope 500
* scheduler: runSweep throw + runScheduledSweep no rechaza + running=false + retry
* resetSession fail → pending + retry
* first contact Hola / consulta / humano / frase
* fallback post-menú
* assigned skip
* e2e inscripción → menú, no fallback
* Promise.all dos SIDs → 1 welcome + 1 fallback
* SQL: índice, 5 cascades en 0, audit_logs > 0, idempotencia

```text
npm run test:unit   existe pero solo corre flow-engine.service.test.js (no usado como suite)
npm run lint        no existe
npm run typecheck   no existe
npm run build       no existe
```

## Lint / typecheck / build

```text
lint       N/A (no hay script ni ESLint en whatsapp-bot)
typecheck  N/A
build      N/A (Node ESM)
full suite PASS 225/225
```

## Working tree de esta tarea

Solo archivos `whatsapp-bot/` listados en `implementation-corrections-diffstat.txt`.
No hay cambios frontend en el status actual. Los archivos nuevos siguen
untracked hasta un commit explícito (no se commitió).

## Riesgos restantes

- Lock inbound es por proceso. Multi-instancia puede aún duplicar welcome
  en un first contact simultáneo cruzado entre nodos.
- El job default queda `CONVERSATION_RETENTION_ENABLED=false` hasta rollout
  en staging.
- Google Sheets: las filas externas no se borran (solo `conversation_sheet_exports`).
