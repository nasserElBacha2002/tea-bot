# Tea Bot — Evidencia de validación

**Fecha:** 10/11/2026.  
**Alcance:** diagnóstico. No se modificó código, configuración, feature flags ni migraciones. No se hizo commit, push ni merge.

## 1. Git

| Dato | Valor |
|---|---|
| Rama | `main` |
| HEAD | `06f26d8b02b9043e2f1ae5688c091084175fc593` |
| Asunto | Add manual takeover flow with schema guard |
| Fecha del commit | 2026-11-08 12:25:17 -0300 |
| Autor | Nasser El Bacha |
| `origin/main` | `9b2ff0be71058a11713b97146a20f683b631eda5` (2026-11-05, asunto `updates`) |
| Relación | `main` está **1 commit adelante** de `origin/main`. No está pusheado. |
| Working tree | Limpio. Sin staged, unstaged ni untracked. |
| Remoto | `https://github.com/nasserElBacha2002/tea-bot.git` |
| CI en el repositorio | No hay `.github/workflows` ni otro pipeline de proyecto. Los YAML encontrados están dentro de `node_modules`. |

`git log --oneline HEAD...origin/main` devuelve solo `06f26d8`.

Ese commit agrega la toma manual, la migración 009, el turn guard, los tests y los exportes de `audit/takeover-review/` y `audit/takeover-corrections/`. El snapshot `audit/takeover-review/implementation-status.txt` describe el trabajo **antes** de este commit, con HEAD `9b2ff0b` y archivos sin commitear. Quedó histórico. El estado actual es el commit.

## 2. Qué está en cada sitio

| Superficie | Estado observado |
|---|---|
| Código local `06f26d8` | Incluye reentrada (ya estaba) y toma manual. |
| `origin/main` `9b2ff0b` | Incluye reentrada y monitoreo 007. No incluye toma ni migración 009. |
| CI | Inexistente. Un merge no tiene gate automático. |
| Base local | `localhost`, base `tea-bot`, usuario `sa`. Migraciones 001–008 registradas. 009 ausente. |
| Entorno TEST aislado | No configurado. Las pruebas de toma exigen `DB_SERVER` local y `DB_NAME` que contenga `test`. Esta base se llama `tea-bot`. |
| Producción | `NOT_VERIFIED`. No se consultó el servidor. `frontend/Dockerfile` y `docker-compose.yml` tienen como default de build `VITE_API_BASE_URL=http://170.239.85.196:3000`. Eso documenta un destino de imagen, no prueba qué commit corre ahí ni qué migraciones tiene. |

## 3. Feature flags

Valores leídos del código y del `.env` local. No se imprimieron secretos ni hashes.

| Flag | Default de código | `.env.example` | `.env` local el 10/11 | Efecto |
|---|---|---|---|---|
| `MANUAL_TAKEOVER_ENABLED` | apagado si falta o está vacío | comentado en `false` | no definido | La toma responde `TAKEOVER_DISABLED`. El claim conserva el inbox anterior y rechaza `bot`. |
| `REENTRY_POLICY` | `prompt` | comentado | no definido | El cierre arma `reentry_json` si la columna existe. `legacy` vuelve al cursor de menú. `degraded` se usa cuando falta la columna. |
| `MONITORING_ENABLED` | `false` | `true` | no definido | En este proceso local la idempotencia SQL del webhook queda apagada. |
| `CONVERSATION_DB_ENABLED` | auto si hay `DB_*` | `true` | `true` | Persistencia SQL activa en local. |
| `FLOW_STORAGE_MODE` | — | `db` | `db` | El motor publica desde SQL. |
| `TWILIO_RECONCILIATION_ENABLED` | `false` | `true` en el ejemplo | no definido | La conciliación de SID no corre en local. |
| `CONVERSATION_CLASSIFICATION_MODE` | `legacy` | `shadow` | `shadow` | Clasificación en sombra. |
| `CONVERSATION_RETENTION_ENABLED` | apagado | `false` | no definido | Retención apagada. |
| `INTERNAL_AGENT_ID` | si está definido, `resolveAgentIdFromUsername` lo devuelve para cualquier usuario | comentado | no definido | En local cada cuenta tiene un id derivado de su nombre. Si alguien define la variable, admin y operador colapsan al mismo id. |
| `TWILIO_SIGNATURE_MODE` | no existe | no existe | no existe | El callback de estado siempre exige firma. El inbound no la mira. |

`ADMIN_PASSWORD_HASH` está definido en local y tiene 64 caracteres. El contenido no se leyó. El arranque exige SHA-256 hex.

## 4. Migraciones

Inventario de archivos en `whatsapp-bot/migrations/`:

| Archivo | Objetivo | Dependencia | Compatible con el código de `06f26d8` | Local `tea-bot` | Producción | Rollback |
|---|---|---|---|---|---|---|
| 001 `conversations_phase1` | Conversaciones, mensajes y sesiones | Ninguna | Sí | Aplicada 2026-05-21, `success=true` | `NOT_VERIFIED` | Forward-only. Dropear tablas borra historial. |
| 002 `human_handoffs` | Cola humana | 001 | Sí | Aplicada 2026-05-21 | `NOT_VERIFIED` | Igual. |
| 003 `flows_schema` | Flujos versionados en SQL | Ninguna de conversaciones | Sí. `FLOW_STORAGE_MODE=db` la necesita | Aplicada 2026-05-21 | `NOT_VERIFIED` | El runtime deja de cargar flujos si se revierte el esquema. |
| 004 `audit_logs` | Auditoría de gestión | Ninguna dura | Sí. La toma también escribe aquí | Aplicada 2026-06-24 | `NOT_VERIFIED` | Perder filas de auditoría. |
| 005 `contact_email` | Email de contacto | 001 | Sí | Aplicada 2026-06-24 | `NOT_VERIFIED` | Columna nullable. El código tolera ausencia solo si no la escribe. |
| 006 `conversation_classification` | Clasificación y `tracking_json` | 001 | Sí, modo `shadow` | Aplicada 2026-07-27 | `NOT_VERIFIED` | El modo `legacy` no exige la tabla para el turno. |
| 007 `monitoring` | `provider_webhook_events`, delivery, incidentes, índices | 001 para índices de mensajes | Sí. El gate de aplicación sigue atado al flag | Aplicada 2026-10-16. Tablas presentes | `NOT_VERIFIED` | No dropear. Apagar flags de monitoreo. |
| 008 `conversation_reentry` | `conversations.reentry_json` | 001 | Sí. Sin columna, policy `prompt` degrada y no escribe el JSON | Aplicada 2026-11-04. Columna presente | `NOT_VERIFIED` | No dropear. `REENTRY_POLICY=legacy` vuelve al cursor anterior. |
| 009 `conversation_status_version` | `status_version INT NOT NULL DEFAULT 0` y `conversation_operation_requests` | 001. La toma también usa 008 para limpiar reentrada | El código arranca sin ella si el flag está apagado. Con el flag encendido exige el esquema | **No aplicada.** `schema_migrations` tiene 8 filas. No existe la columna ni la tabla | `NOT_VERIFIED` | Apagar `MANUAL_TAKEOVER_ENABLED` y reiniciar. No dropear columna ni tabla. Lo ya `assigned` sigue `assigned`. |

No hay migraciones posteriores a 009.

Consulta usada, de solo lectura, contra `localhost` / `tea-bot`:

```sql
SELECT filename, success, executed_at
FROM dbo.schema_migrations
ORDER BY filename;

SELECT c.name
FROM sys.columns c
WHERE c.object_id = OBJECT_ID(N'dbo.conversations')
  AND c.name IN (N'reentry_json', N'status_version', N'contact_email');

SELECT name
FROM sys.tables
WHERE name IN (
  N'provider_webhook_events',
  N'conversation_operation_requests',
  N'conversation_classifications',
  N'message_delivery_status'
);
```

Resultado local: `reentry_json` y `contact_email` presentes; `status_version` ausente; `conversation_operation_requests` ausente; `provider_webhook_events` y `message_delivery_status` presentes.

### Consultas para producción, cuando haya una sesión de solo lectura

```sql
SELECT filename, checksum, success, executed_at
FROM dbo.schema_migrations
ORDER BY filename;

SELECT COL_LENGTH('dbo.conversations', 'reentry_json') AS reentry_json,
       COL_LENGTH('dbo.conversations', 'status_version') AS status_version;

SELECT OBJECT_ID(N'dbo.conversation_operation_requests', N'U') AS operation_requests,
       OBJECT_ID(N'dbo.provider_webhook_events', N'U') AS webhook_events;
```

Una fila en `schema_migrations` demuestra que el runner marcó el archivo. Conviene cruzarla con `COL_LENGTH` y `OBJECT_ID`, como arriba. La existencia del archivo en Git no demuestra aplicación.

## 5. Pruebas ejecutadas el 10/11/2026

### 5.1 Corrida inválida, descartada

Desde la raíz del repo, un `node --test` sobre los archivos de `whatsapp-bot` no cargó el flujo `main-menu` ni la persistencia. Resultado: 333 pruebas, 294 pass, 8 fail, 31 skip. Esas 8 fallas no se reprodujeron al correr los mismos archivos desde `whatsapp-bot`. No se usan como defecto del producto.

### 5.2 Suite backend válida

```bash
cd whatsapp-bot
node --test $(find src migrations -name '*.test.js' | sort)
```

Resultado: **331 pruebas, 329 pass, 0 fail, 2 skipped, exit 0.** Duración 34 s.

Skipped, y por eso no aprobadas:

- `integration: toma manual exclusiva en SQL TEST`
- `integration: dos agentes en paralelo sobre SQL real`

Motivo escrito por el test: `SQL TEST aislado no configurado (DB_SERVER local y DB_NAME con "test")`.

Esa suite sí ejecutó integraciones de reentrada, lifecycle, handoff y `acquireInboundProcessing` contra la base local `tea-bot`. Esas pruebas insertan y borran filas de fixture. No están guardadas por el filtro de nombre `test`. Después de la corrida, `dbo.conversations` tiene 15 filas. Las filas `IT-*` visibles son del 18/08/2026 y una de simulador del 05/11/2026. No apareció un fixture `IT-REENTRY` de hoy en el muestreo. La corrida no era el camino más estricto: el filtro de la toma existe precisamente para no escribir en `tea-bot`. Quedó hecho, y las pruebas que corrieron terminaron en verde con su propio `cleanup`.

### 5.3 Subconjunto P0, en serie

```bash
cd whatsapp-bot
node --test --test-concurrency=1 \
  src/services/twilio-inbound-pipeline.test.js \
  src/services/conversation-takeover.service.test.js \
  src/services/conversation-turn-guard.service.test.js \
  src/middleware/verify-twilio-signature.test.js \
  src/services/admin-auth.service.test.js \
  src/services/conversation-reentry.service.test.js
```

Resultado: **64 pass, 0 fail, 0 skip.**

Incluye el caso anonimizado `7ED6C057`, continuar, nueva consulta, pedido de humano, doble clic de toma, conflicto de actores, idempotencia de `clientRequestId`, reentrada después de tomar, y supresión de TwiML cuando el guard devuelve `SUPPRESS`.

### 5.4 Frontend

```bash
cd frontend
npx vitest run \
  src/features/conversations/components/ConversationComposer.test.tsx \
  src/features/conversations/pages/ConversationsPage.test.tsx \
  src/features/conversations/utils/applyConversationLiveEvent.test.ts \
  src/utils/apiError.test.ts
npx tsc -b --noEmit
```

Resultado: **4 archivos, 28 pruebas pass.** Typecheck exit 0.

No se corrió `npm run lint` ni `npm run build` del frontend en esta pasada. El informe de correcciones del 8/11 registró lint en rojo por errores previos, fuera de los archivos de la toma, y build en verde. Eso no se revalidó hoy.

### 5.5 Omitidas a propósito

- Aplicar 009.
- Las dos pruebas de exclusión SQL de la toma.
- Cualquier escritura de configuración.
- Consulta a Twilio, a Usage Records y al host `170.239.85.196`.
- Suite completa de Vitest.
- Prueba de carrera entre el commit de la respuesta y la aceptación HTTP de Twilio.

## 6. Lectura de las pruebas que sí pasaron

Demostrado en local, con dobles o con la base de desarrollo:

- Con policy `prompt` y columna `reentry_json`, el texto libre posterior al cierre ofrece continuar o empezar de nuevo.
- La toma, con el flag forzado dentro del test, deja un solo handoff activo, es idempotente para el mismo actor y responde 409 a otro actor.
- El outbound automático se inserta en la misma transacción que autoriza, o no se inserta.
- `SUPPRESS` anula el TwiML del pipeline de prueba.
- Dos adquisiciones del mismo `MessageSid` dejan una fila `PROCESSING` cuando el gate de monitoreo corre.
- La firma inválida del callback de estado responde 403.

No demostrado:

- Dos transacciones reales compitiendo por `UPDLOCK`.
- El preflight de 009 sobre una base que todavía no la tiene, con el flag encendido.
- Reinicio del proceso con `status_version` ya creada.
- `MONITORING_ENABLED=false` manteniendo la idempotencia SQL.
- Inbound de Twilio rechazado por firma.
- El comportamiento del servidor de producción.

## 7. Despliegue en el repositorio

- `whatsapp-bot/Dockerfile`: Node 22, healthcheck a `GET /health`.
- `frontend/Dockerfile`: build de Vite y Nginx estático. `nginx.conf` solo hace `try_files` hacia `index.html`. No termina TLS ni reescribe el webhook.
- `docker-compose.yml`: bot con `./whatsapp-bot/data` montado, frontend dependiendo de `service_healthy`.
- No hay workflow que publique esa imagen ni que aplique migraciones.

## 8. Documentos de referencia encontrados

| Fuente | Uso |
|---|---|
| `Tea_Bot_Plan_Tecnico_Implementacion_v1_1_2026-11-04.md` | Contrato. Incluye la actualización v1.1 con TB-019 a TB-024. |
| `docs/audit-2026-11/` | Auditoría del 4/11. Sigue siendo válida para firma, idempotencia y hash. Está desactualizada en la toma: dice `NOT_IMPLEMENTED` porque es anterior a `06f26d8`. |
| `audit/takeover-corrections/implementation-corrections-decisions.md` | Decisiones del 8/11. Coinciden con el código actual. Estado que ellas mismas declaran: `IMPLEMENTED_PENDING_VALIDATION`. |
| `audit/takeover-review/` | Export del diff antes del commit. |
| `WHATSAPP_BOT_DEPLOY_READINESS_AUDIT.md` | Auditoría histórica de deploy. No se usó como estado actual. |
| Plan v1.0 como archivo separado | No está en el repositorio. |
| Auditoría original de 13 páginas como archivo propio | No está. El plan la cita como fuente histórica. |
