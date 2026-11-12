# TEA_BOT_P0_AUDIT_FINAL.md

**Fecha de auditoría:** 2026-11-12  
**Rama:** `main`  
**HEAD local / `origin/main`:** `36ba9afe35e48e06736038d7f9ea97aa97831a4a` — *Generate takeover request ids without crypto.randomUUID.*  
**Alcance:** DIN-423, DIN-424, DIN-425, DIN-426  
**Modo:** solo lectura. Sin commits, push, migraciones, deploys, reinicios ni mensajes reales a Twilio.

**Respuesta operativa:** ninguno de los cuatro P0 puede marcarse como completado hoy. La implementación en `main` está presente y las pruebas locales (unitarias, HTTP, SQL TEST) pasan. Falta evidencia funcional de producción suficiente, y DIN-426 no cumple el criterio de rechazo de firmas inválidas mientras el inbound permanezca fuera de `enforce`.

---

## A. Resumen ejecutivo

| Ticket | Funcionalidad | Estado final | Prioridad | ¿Se puede cerrar? |
|---|---|---|---|---|
| DIN-423 | Toma manual | `IMPLEMENTED_PENDING_VALIDATION` | P0 | No |
| DIN-424 | Reentrada | `IMPLEMENTED_PENDING_VALIDATION` | P0 | No |
| DIN-425 | Migraciones | `IMPLEMENTED_PENDING_VALIDATION` | P0 | No |
| DIN-426 | Seguridad Twilio | `PARTIALLY_IMPLEMENTED` | P0 | No |

**Resultado global:** `P0_PENDING_VALIDATION`

Ningún ticket alcanza `DONE_VERIFIED`. Cerrarlos hoy exigiría afirmar que funcionan en el entorno requerido. Esta sesión verificó el código de `main`, tests locales y el esquema de la base de pruebas `tea-bot`. El backend público responde, pero no se pudo leer el commit desplegado, las variables efectivas ni `schema_migrations` de producción.

---

## Estado Git y despliegue (Fase A / D, compartido)

### Código actual

- Rama única: `main`, alineada con `origin/main`.
- Working tree sucio por documentos de auditoría no versionados (`audit/takeover-p0-production/`, `audit/takeover-randomuuid-hotfix/`) y un markdown local modificado. Eso no cambia el runtime de `HEAD`.
- Commits posteriores al SHA histórico `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937`:
  1. `0d1814a` — updates (takeover / inbox)
  2. `132d978` — *Restrict exclusive takeover so only the owner can end attention.*
  3. `36ba9af` — hotfix frontend: `clientRequestId` sin `crypto.randomUUID` directo

`36ba9af` toca solo frontend (`ConversationsPage.tsx`, `clientRequestId.ts` y tests). El backend de toma, reentrada, migraciones y firma Twilio quedó en `132d978` o antes.

### Producción — verificado en vivo el 2026-11-12

| Comprobación | Resultado |
|---|---|
| `GET https://bot.dinamiceducation.com/health` | HTTP 200. `service=whatsapp-bot`, `environment=development` |
| `GET https://bot.dinamiceducation.com/healthz` | HTTP 200. `nodeEnv=development`, `activePublishedFlow=true`, Meta no configurado |
| SSH `nasser@170.239.85.196:37783` | `Permission denied (publickey,password)` |
| Commit del checkout productivo | **NO VERIFICADO** |
| Digest de `tea-whatsapp-bot` / `tea-frontend` | **NO VERIFICADO** |
| `MANUAL_TAKEOVER_ENABLED` efectivo | **NO VERIFICADO** |
| `TWILIO_SIGNATURE_MODE` efectivo | **NO VERIFICADO** |
| `REENTRY_POLICY` efectivo | **NO VERIFICADO** |
| `schema_migrations` de `tea_bot` | **NO VERIFICADO** |

Hay notas locales no commiteadas del 2026-11-10 (`audit/takeover-p0-production/`, `audit/takeover-randomuuid-hotfix/`) que describen un deploy de backend `132d978`, frontend `36ba9af`, flag de toma en `true`, firma en `log` y migración 009 aplicada. Esas notas **no se reconfirmaron** en esta auditoría. No se usan como prueba de estado actual.

Hallazgo vivo, independiente de esas notas: el proceso público declara `NODE_ENV=development`.

### Base local de pruebas (sí verificada)

Conexión de solo lectura a `localhost:1433`, base `tea-bot` (15 conversaciones). `schema_migrations`:

| Archivo | Checksum local del archivo | Checksum en DB | success | executed_at |
|---|---|---|---|---|
| `008_conversation_reentry.sql` | `e8823b699a02e11862d00ead00df044d074e5120a3680b44b83506fd1bc274dc` | coincide | true | 2026-11-04T14:36:49Z |
| `009_conversation_status_version.sql` | `b07a318cf81e140ad60d34b7802efc9f6a59c0eff33e5a54d0da716aab0a763f` | coincide | true | 2026-11-10T18:21:05Z |
| `010_webhook_response_body.sql` | `4ac060bbd6d1fe7cf8b171607e323cf97a48e36775bf93eecbf56c7a38d5f3ab` | coincide | true | 2026-11-10T15:13:59Z |

También aplicadas: 001–007. Columnas: `reentry_json` nvarchar NULL; `status_version` int NOT NULL default `((0))`, 0 nulos. Tabla `conversation_operation_requests` presente, con `PK_conversation_operation_requests` y `UQ_conversation_operation_request`. `provider_webhook_events.response_body` existe (`COL_LENGTH = -1`, típico de `nvarchar(max)`).

`.env` local no define `MANUAL_TAKEOVER_ENABLED`, `TWILIO_SIGNATURE_MODE` ni `REENTRY_POLICY` (defaults: toma apagada, firma inbound `off`, reentrada `prompt`). Las pruebas de integración activaron los flags en el proceso, sin escribir el archivo.

### Tests ejecutados en esta sesión

| Suite | Tipo | Resultado |
|---|---|---|
| Takeover, reentrada, firma Twilio, turn-guard, roles, handoff (11 archivos) | Unitaria / HTTP in-process | **110 passed / 0 failed** |
| Integración SQL TEST `tea-bot` (takeover, return, reentry, distributed) | Integración SQL + HTTP local | **25 passed / 0 skipped / 0 failed** |
| Frontend takeover / composer / live events / clientRequestId | Unitaria Vitest | **36 passed / 0 failed** |

No se ejecutó un click real en el panel productivo. No se envió tráfico a Twilio. No se aplicaron migraciones.

---

## B. Informe técnico por ticket

### DIN-423 — Toma manual de conversaciones

#### 1. Qué se encontró implementado

El endpoint existe, está montado bajo autenticación y cubre los dos perfiles autorizados (`admin` y `conversations_only`).

**Trazabilidad end-to-end**

| Capa | Ubicación |
|---|---|
| UI | `frontend/src/features/conversations/components/ConversationComposer.tsx` (botón *Tomar conversación* si `canTakeover`) y `ConversationDetail.tsx` |
| Cliente | `conversationsApi.takeover` → `POST /api/conversations/:id/takeover` con `expectedVersion` y `clientRequestId` |
| Página | `ConversationsPage.tsx` arma la clave `takeover:{id}:{statusVersion}` y reutiliza el id en reintentos |
| Router | `whatsapp-bot/src/routes/conversations.routes.js` línea 18 (`requireAuth`) y línea 22 (`POST /:conversationId/takeover`) |
| Montaje | `create-app.js` → `app.use('/api/conversations', conversationsRouter)` |
| Controller | `takeoverConversation` en `conversations.controller.js` |
| Autorización de rol | `canTakeoverConversation` en `auth/roles.js` (solo `admin` y `conversations_only`) |
| Flag | `isManualTakeoverEnabled()` lee `MANUAL_TAKEOVER_ENABLED`; default **false** |
| Servicio | `ConversationTakeoverService.takeover` |
| Concurrencia | `findByIdForUpdate` (`UPDLOCK, ROWLOCK`) + `status_version` + tabla `conversation_operation_requests` |
| Pausa del bot | `status='assigned'`, `pauseAllOpenForConversation`, `sessionService.resetSession`, inbound `isConversationInHumanMode` salta el motor |
| Guard de outbound | `authorizeAutomaticReply` suprime si el status deja de ser `bot` o si `statusVersion` cambió |

El error histórico de no poder tomar una conversación en `bot` corresponde al claim legado:

```210:216:whatsapp-bot/src/services/conversation-inbox.service.js
    if (conversation.status === 'bot') {
      throw appError(
        'CONVERSATION_BOT_ACTIVE',
        'El bot está activo en esta conversación. No se puede tomar sin derivación humana.',
        409,
      );
```

Esa rama **solo corre si el flag está apagado**. Con el flag encendido, `claimConversation` delega en `conversationTakeoverService.takeover`. El frontend, si `canTakeover` es true, llama `/takeover` y no `/claim`.

Estados que la toma acepta: `bot`, `waiting_human`, `paused`, y `assigned` sin dueño. Si ya hay dueño: 409 `CONVERSATION_OWNED`. El dueño reenviando el mismo `clientRequestId` obtiene idempotencia. Versión distinta: 409 `STATUS_VERSION_CONFLICT`. Flag off: 409 `TAKEOVER_DISABLED`. Rol no autorizado: 403 `FORBIDDEN`. Cerrada: 409 `CONVERSATION_CLOSED`. Esquema 009 ausente con flag on: 503 `TAKEOVER_SCHEMA_REQUIRED`.

El hotfix `36ba9af` cubre el fallo de panel en origen HTTP (sin `crypto.randomUUID`): `createClientRequestId()` usa `randomUUID` si existe y, si no, `getRandomValues`.

#### 2. Qué falta

- Click real en producción con **administrador** y **operador**.
- Confirmación del commit y de `MANUAL_TAKEOVER_ENABLED` en el contenedor productivo.
- Si el frontend servido no incluye `36ba9af`, el click puede volver a fallar antes de llegar al API.

#### 3. Evidencia concreta

- Router: `whatsapp-bot/src/routes/conversations.routes.js:18-22`
- Roles: `whatsapp-bot/src/auth/roles.js:52-54`
- Toma + lock + versión: `whatsapp-bot/src/services/conversation-takeover.service.js:151-313`
- Pausa de sesión de flujo: `whatsapp-bot/src/repositories/conversation-session.repository.js:181-191`
- Inbound humano no dispara bot: `whatsapp-bot/src/utils/handoff-detection.js:29-32` y `message-persistence.service.js:80-86`
- Frontend API: `frontend/src/features/conversations/api/conversationsApi.ts:70-76`
- Frontend click: `frontend/src/features/conversations/pages/ConversationsPage.tsx:514-529`
- Flag default off: `whatsapp-bot/src/utils/manual-takeover-flag.js` y `whatsapp-bot/.env.example:49-54`

#### 4. Tests existentes y ejecutados

Existentes y **ejecutados**:

- Unitarios: dos agentes en paralelo, idempotencia, flag off, reentrada cancelada al tomar, outbound del bot suprimido.
- HTTP local: admin y `conversations_only` con `canTakeover=true`; toma 200; segundo agente 409 `CONVERSATION_OWNED` (`conversation-return-authorization.integration.test.js`).
- SQL real: `integration: toma manual exclusiva en SQL TEST` y `dos agentes en paralelo sobre SQL real`.
- Dos procesos: `integration: dos procesos toman la misma conversación en SQL TEST`.
- Frontend: envío de `clientRequestId` UUID, reintento conserva el id, 409 visible, fallback sin CSPRNG.

No ejecutados (requieren panel o WhatsApp real): E2E productivo.

#### 5. Resultado de las pruebas

Local: **pass**. Ambos perfiles toman `bot`, un solo ganador en carrera, el perdedor recibe `CONVERSATION_OWNED`, el bot queda `assigned` y el inbound posterior no responde solo (unitario + SQL).

Producción: **no ejecutado**.

#### 6. Estado de producción

Backend público vivo. Commit, flag e imágenes **NO VERIFICADOS**. Las notas del 2026-11-10 ya dejaban pendiente el click de panel.

#### 7. Riesgos detectados

- Flag apagado en producción reintroduce `CONVERSATION_BOT_ACTIVE` / botón ausente en `bot`.
- Frontend pre-`36ba9af` rompe el click en HTTP no seguro.
- `INTERNAL_AGENT_ID` colapsa admin y operador; el arranque lo bloquea solo si el flag está on.

#### 8. Justificación del estado final

Implementación completa en `main` y validada en SQL TEST / HTTP local. El criterio de aceptación exige que ambos perfiles tomen sin error en el entorno requerido. Eso no se observó en producción. No es `DONE_VERIFIED`.

#### 9. Recomendación de cierre

**No cerrar.** Cerrar solo después de: (a) leer `MANUAL_TAKEOVER_ENABLED` y el digest desplegado; (b) una toma controlada por admin y otra por operador sobre conversaciones de prueba; (c) confirmar un único `assigned_agent_id` y que el bot no responde mientras está tomada.

| Dimensión | Resultado |
|---|---|
| Código implementado | Sí |
| Backend funcional | Sí (local) |
| Frontend integrado | Sí (tests; panel prod no verificado) |
| Tests suficientes | Parcial (faltan E2E de panel) |
| Migraciones correctas | Sí en local; producción no verificada (ver DIN-425) |
| Desplegado en producción | No verificado |
| Funciona en producción | No verificado |
| Riesgos pendientes | Flag, frontend hotfix, ausencia de prueba humana |

---

### DIN-424 — Cierre humano y reentrada del bot

#### 1. Qué se encontró implementado

El ciclo pedido está implementado y cubierto por integración SQL.

Flujo reconstruido:

1. Inbound Twilio → `processCanonicalTwilioInbound` → persistencia + motor.
2. Handoff o toma → `waiting_human` / `assigned` / `paused`. `isConversationInHumanMode` salta el motor.
3. Cierre/devolución → `closeConversation` / `returnConversationToBot` → `ConversationBotLifecycleService.returnConversationToBot`.
4. Con `REENTRY_POLICY=prompt` (default) escribe `reentry_json` (`status: pending`, `resumeNodeKey`, variables, history, tracking).
5. Siguiente texto libre → `conversationReentryService.consumeInbound` presenta el prompt; no entra al matcher del menú.
6. `1` / continuar restaura el nodo publicado si el contrato coincide; `2` / nueva consulta va al entry; humano abre handoff; inválidos repreguntan hasta 3.
7. `updateFlowPositionIfNoReentry` solo actualiza cursor si `reentry_json IS NULL AND status = N'bot'`.
8. Duplicados: mismo `MessageSid` no consume dos veces (`replayTurnEffect`). Dos webhooks distintos dejan un solo `awaiting_choice`.
9. Carrera motor vs reentrada: el UPDATE condicional no pisa el snapshot. `authorizeAutomaticReply` suprime si hubo takeover (cambia `status_version`).
10. Sin columna 008: política `degraded`, cierre con cursor null y sin snapshot.
11. `REENTRY_POLICY=legacy`: limpia snapshot y presenta entry.

Migración `008_conversation_reentry.sql`: `ALTER` aditivo, `reentry_json NVARCHAR(MAX) NULL`. Idempotente por `COL_LENGTH`.

#### 2. Qué falta

- Un mensaje WhatsApp real después de un cierre humano en producción (flujo publicado productivo, no el `main-menu` v24 de la base local).
- Lectura de `REENTRY_POLICY` en el contenedor productivo.

#### 3. Evidencia concreta

- Migración: `whatsapp-bot/migrations/008_conversation_reentry.sql`
- Snapshot: `whatsapp-bot/src/utils/conversation-reentry-policy.js` (`buildReentrySnapshot`, `classifyReentryInput`, `resolveReentryPolicy`)
- Cierre: `whatsapp-bot/src/services/conversation-bot-lifecycle.service.js:106-228`
- Consumo inbound: `whatsapp-bot/src/services/conversation-reentry.service.js:180-324`
- Fence del motor: `whatsapp-bot/src/repositories/conversation.repository.js:276-303`
- Pipeline: `whatsapp-bot/src/services/twilio-inbound-pipeline.js:80-200` y `message-persistence.service.js:67-110`

#### 4. Tests existentes y ejecutados

Ejecutados (SQL TEST, sin skips):

- Cierre + texto libre quedan en reentrada, no en welcome.
- Continuar restaura el nodo publicado de la misma versión.
- Nueva consulta presenta entry y no matchea el comando.
- Handoff activo no responde con el prompt.
- Dos webhooks → un `awaiting_choice`; mismo `MessageSid` no consume dos veces.
- Sync del motor no pisa cursor con reentrada pendiente.
- Toma manual no absorbe una reentrada en `bot`.
- Versión histórica ausente reinicia.
- Contador de intentos sobrevive a otra instancia.
- Double close idempotente; rollback conserva handoff activo.

Unitarios de reentrada y lifecycle: pass.

No ejecutado: inbound Twilio real post-cierre.

#### 5. Resultado de las pruebas

Local: **pass** sobre el ciclo integral en SQL TEST (simulador/internal, no WhatsApp).  
Producción: **no verificado**.

Nota: la base local publicó `main-menu` v24 durante las pruebas. Las notas de deploy hablan de v62 en producción. La compatibilidad de reanudación depende del contrato del nodo publicado; no se probó contra el snapshot productivo.

#### 6. Estado de producción

008 está en el código y en `tea-bot`. Producción `tea_bot`: **NO VERIFICADO** hoy. El ciclo WhatsApp post-cierre no se observó.

#### 7. Riesgos detectados

- Si 008 faltara en prod y `REENTRY_POLICY=prompt`, el cierre degradaría (cursor null, sin elección).
- Reanudar contra un flujo cuyo nodo cambió (v24 vs v62) fuerza restart, no un nodo incorrecto; es seguro, pero no “continuar”.
- Mensajes durante asignación humana se persisten y no disparan bot; correcto, no cubierto en WhatsApp real en esta sesión.

#### 8. Justificación del estado final

El código y las pruebas locales cubren el criterio. Falta el comportamiento integral en el canal real y la confirmación de esquema/política productivos. Encontrar `reentry_json` no alcanza; el ticket lo dice. Por eso no es `DONE_VERIFIED`.

#### 9. Recomendación de cierre

**No cerrar.** Cerrar cuando un hilo de prueba WhatsApp complete: bot → humano → cierre → prompt → continuar o nueva consulta, sin duplicados ni nodo incorrecto, sobre el flujo publicado.

| Dimensión | Resultado |
|---|---|
| Código implementado | Sí |
| Backend funcional | Sí (local, SQL TEST) |
| Frontend integrado | No aplica (ciclo de canal, no de panel) |
| Tests suficientes | Parcial (faltan WhatsApp / prod) |
| Migraciones correctas | Sí en local (008); prod no verificada |
| Desplegado en producción | No verificado |
| Funciona en producción | No verificado |
| Riesgos pendientes | Política, versión de flujo, 008 en prod |

---

### DIN-425 — Migraciones 009/010 y consistencia de producción

#### 1. Qué se encontró implementado

**009 `conversation_status_version.sql`** — sigue siendo **necesaria** para la toma. No fue reemplazada.

- `conversations.status_version INT NOT NULL DEFAULT 0`
- `conversation_operation_requests` (unicidad por conversación + operación + `client_request_id`)
- Idempotente: `IF COL_LENGTH ... IS NULL` / `IF OBJECT_ID ... IS NULL`
- Rollback de funcionalidad documentado: apagar `MANUAL_TAKEOVER_ENABLED`; no dropear columnas
- El backend exige 009 solo con el flag on (`assertTakeoverSchema`). Con flag off, el bot no requiere la columna para responder.

**010 `webhook_response_body.sql`** — independiente de la toma. Agrega `provider_webhook_events.response_body` para replay TwiML. No sustituye 009.

Orden del runner: archivos `*.sql` ordenados por nombre. No hay FK entre 009 y 010. 010 puede existir sin 009 (fue el caso histórico). 009 puede aplicarse después.

Checksum de 009 en disco = checksum en `tea-bot` = el que citan las notas de prod del 2026-11-10: `b07a318cf81e140ad60d34b7802efc9f6a59c0eff33e5a54d0da716aab0a763f`.

El SHA `2ccaeb6` **ya no es** el HEAD. Es un ancestro. El backend de toma actual es `132d978` + hotfix frontend `36ba9af`.

#### 2. Qué falta

SELECT de `schema_migrations` y columnas en `tea_bot` de producción. SSH rechazó la clave. Sin eso no se puede afirmar que 009 siga aplicada ni que el esquema coincida con la imagen en ejecución.

#### 3. Evidencia concreta

- `whatsapp-bot/migrations/009_conversation_status_version.sql`
- `whatsapp-bot/migrations/010_webhook_response_body.sql`
- Guard: `conversation.repository.js:244-261` (`assertTakeoverSchema`)
- Incremento de versión: `conversation.repository.js:188-197`
- Runner: `whatsapp-bot/src/db/migration-runner.js` (checksum mismatch aborta; dry-run no aplica)

#### 4. Tests existentes y ejecutados

No hay un test de “migración 009 aplicada en prod”. Los tests de takeover **skipean** si 009 falta. En esta sesión **no skipearon**: 009 está en `tea-bot` y las 25 integraciones pasaron.

No se ejecutó `db:migrate` ni `db:migrate:status` (el status llama `ensureSchemaMigrationsTable`, que puede CREATE/ALTER).

#### 5. Resultado de las pruebas

Local: esquema compatible con el código de takeover y reentrada.  
Producción: **NO VERIFICADO**.

#### 6. Estado de producción

Antecedente del ticket (009 pendiente, 010 aplicada, backend `2ccaeb6`) **no es el estado de `main`**. Puede no ser tampoco el de producción. Las notas del 2026-11-10 dicen que 009 se aplicó ese día. Esta auditoría no lo releyó.

`010` aplicada no cierra el ticket: 009 es la dependencia de la toma.

#### 7. Riesgos detectados

- Encender `MANUAL_TAKEOVER_ENABLED` sin 009 → 503 `TAKEOVER_SCHEMA_REQUIRED` en cada toma.
- Reaplicar 009 es seguro (idempotente) salvo que el checksum del archivo hubiera cambiado; hoy coincide.
- Diferencia local vs prod posible: no hay lectura prod.

#### 8. Justificación del estado final

009 es necesaria, está en el repo, está en `tea-bot` y el código la usa. El criterio pide esquema **productivo** compatible con el backend **desplegado**. Esa dupla no se verificó hoy. No se cierra porque 010 figure aplicada en un deploy anterior.

#### 9. Recomendación de cierre

**No cerrar.** Cerrar cuando un SELECT de solo lectura en `tea_bot` muestre 009 y 010 con `success=1` y checksums iguales a los de `HEAD`, y el contenedor corra el binario que llama `assertTakeoverSchema`.

| Dimensión | Resultado |
|---|---|
| Código implementado | Sí |
| Backend funcional | Sí (local) |
| Frontend integrado | No aplica |
| Tests suficientes | Parcial (local sí; prod no) |
| Migraciones correctas | Sí en local; producción no verificada |
| Desplegado en producción | No verificado |
| Funciona en producción | No verificado |
| Riesgos pendientes | 009 ausente + flag on; checksum drift |

---

### DIN-426 — Seguridad de webhooks Twilio

#### 1. Qué se encontró implementado

Hay dos middlewares distintos:

| Ruta | Middleware | Comportamiento |
|---|---|---|
| `POST /webhooks/twilio/:flowId` | `verifyTwilioInboundSignature` | Respeta `TWILIO_SIGNATURE_MODE`: `off` / `log` / `enforce` |
| `POST /webhooks/twilio/:flowId/status` | `verifyTwilioSignature` | **Siempre** exige firma. Ausente o inválida → 403. No usa el modo inbound |

Montaje: `create-app.js:36` y `twilio-webhook.routes.js:12-13`. Body urlencoded con `rememberUrlencodedBody`. Error de parseo Twilio → 4xx, no 500.

URL firmada: origen + prefijo **solo de configuración** (`APP_BASE_URL`, `TWILIO_PUBLIC_PATH_PREFIX`). **No** usa `X-Forwarded-Proto` ni `X-Forwarded-Host` (correcto frente a spoofing). Compatible con Nginx si la URL pública configurada es la que Twilio firma.

Modos:

- `off` (default si la variable falta): inbound sin autenticar; se loguea bypass.
- `log`: firma inválida o ausente se registra y **se procesa** (HTTP 200).
- `enforce`: inválida o ausente → 403, el controlador no corre.

`assessTwilioSignatureReadiness` deja `enforceReady: false` de forma explícita: enforce no es el default ni el estado de “listo” del preflight.

Logging: evento JSON con ruta, modo, result, correlationId y pathname; no token, no firma, no query.

Rutas alternativas:

- `/webhook` es Meta Cloud API, no Twilio. Fuera del contrato Twilio; no valida firma Twilio.
- `/api/dev/conversations/inbound-message` exige cookie admin. En `NODE_ENV !== 'production'` queda habilitado. El healthz productivo declara `nodeEnv=development` → esa ruta **existe** detrás de auth admin.

#### 2. Qué falta

El criterio de aceptación exige que firmas inválidas o ausentes **se rechacen** en el entorno que requiere protección. `log` no rechaza. `enforce` no está evidenciado como activo. El modo efectivo de producción **no se leyó** (SSH denegado). El healthz no lo expone.

#### 3. Evidencia concreta

- Evaluación inbound: `whatsapp-bot/src/middleware/verify-twilio-signature.js:122-243` (`log` permite missing/invalid)
- Status estricto: mismas líneas 28-46
- URL pública: `whatsapp-bot/src/config.js:47-134` y `resolveInboundSignatureUrl`
- Default off: `resolveTwilioSignatureMode` si la variable está vacía
- Preflight: `enforceReady: false` en `config.js:185`
- `.env.example`: `TWILIO_SIGNATURE_MODE=log` comentado; no activa enforce

#### 4. Tests existentes y ejecutados

Ejecutados (pass):

- T01 enforce + firma válida → 200 y entra
- T02 enforce inválida → 403, no entra
- T03 enforce ausente → 403
- T04 **log inválida → 200 y se procesa** (documenta la brecha de protección)
- T09 URL https, ignora proto del proxy
- T12 `X-Forwarded-Host` no altera la URL
- T17 status exige firma aunque inbound esté `off` o `log`
- Ensamblado HTTP real de `createApp()`: enforce inválida no llega al TwiML

#### 5. Resultado de las pruebas

Código: **pass**. Demuestran a la vez que `enforce` protege y que `log` **no** protege.  
Producción: modo **NO VERIFICADO**. Health público no alcanza. No se envió POST de prueba al webhook (en `log` un POST falso se procesaría).

#### 6. Estado de producción

Vivo, `environment=development`. Notas del 2026-11-10: `TWILIO_SIGNATURE_MODE=log`, `APP_BASE_URL=https://bot.dinamiceducation.com`. No reconfirmado. Incluso si sigue en `log`, el ticket **no** está cumplido: “la existencia del middleware o su ejecución en modo `log` no equivale a protección efectiva”.

#### 7. Riesgos detectados

- **CRITICAL (si el modo no es enforce):** cualquiera que alcance la URL pública puede inyectar un inbound Twilio sintético.
- **HIGH:** `NODE_ENV=development` en el proceso público (verificado hoy). Relaja `validateConfig` y habilita tools de dev tras auth admin.
- Status callback sí está protegido en código; no se observó un callback real de Twilio en esta sesión.

#### 8. Justificación del estado final

No es “implementado pendiente de validar”: la protección inbound efectiva (`enforce`) no está activada como requisito cumplido, y `log` está diseñado para dejar pasar firmas malas. Eso es **parcial** respecto del criterio de aceptación. Tampoco es `DONE_VERIFIED`.

#### 9. Recomendación de cierre

**No cerrar.** Cerrar cuando: (1) `TWILIO_SIGNATURE_MODE=enforce` esté en el contenedor; (2) un POST sin firma o con firma inválida a `https://bot.dinamiceducation.com/webhooks/twilio/main-menu` responda 403 y no adquiera el evento; (3) un inbound real de Twilio siga en 200 con `twilio_signature_valid`.

| Dimensión | Resultado |
|---|---|
| Código implementado | Parcial (enforce existe; no es el modo exigido por el criterio) |
| Backend funcional | Sí para los tres modos (tests); protección efectiva solo en `enforce` |
| Frontend integrado | No aplica |
| Tests suficientes | Sí para el contrato de firma; no hay prueba enforce-en-prod |
| Migraciones correctas | No aplica (010 es replay TwiML, no la firma) |
| Desplegado en producción | No verificado (código de firma probablemente sí; modo enforce no) |
| Funciona en producción | No verificado; `log` no cumpliría el criterio |
| Riesgos pendientes | Inbound sin rechazo; NODE_ENV=development |

---

## C. Hallazgos adicionales (solo P0)

| Severidad | Ticket | Hallazgo |
|---|---|---|
| CRITICAL | DIN-426 | Mientras el inbound no esté en `enforce`, una firma inválida o ausente se procesa. Confirmado por test T04. Modo prod no leído hoy. |
| HIGH | DIN-426 | `/healthz` productivo del 2026-11-12 declara `nodeEnv=development`. Habilita `/api/dev/conversations` (auth admin) y omite chequeos de arranque de producción. |
| HIGH | DIN-423 | Sin prueba de panel con las dos cuentas, no hay evidencia de que el error original (`CONVERSATION_BOT_ACTIVE` / click roto por `randomUUID`) esté resuelto para operadores reales. |
| MEDIUM | DIN-425 | SSH sin clave: no se pudo contrastar `schema_migrations` de `tea_bot` con `HEAD`. |
| MEDIUM | DIN-423 | El hotfix `36ba9af` es solo frontend. Un backend nuevo con UI vieja sigue rompiendo el click en HTTP. |
| LOW | DIN-423 | Con flag off, `waiting_human` sigue usando `/claim`. Coherente, pero el mensaje de `bot` activo puede reaparecer si se apaga el flag. |

No se expandió a módulos ajenos (Sheets, clasificación, retención), salvo el `NODE_ENV` porque afecta la superficie inbound/dev.

---

## D. Plan mínimo de correcciones

Orden por impacto, dependencia y riesgo. **No implementar en esta auditoría.**

1. **DIN-425 — evidencia de esquema prod (solo lectura)**  
   SELECT de `schema_migrations` y columnas 008/009/010 en `tea_bot`. Si 009 falta, aplicarla (fuera de esta auditoría) **antes** de cualquier prueba de toma. No dropear nada.

2. **DIN-423 — confirmar runtime**  
   Leer `MANUAL_TAKEOVER_ENABLED`, digest backend/frontend y que el bundle sirva `clientRequestId` / `getRandomValues`. Si el flag está off, encenderlo solo con 009 presente. Luego toma controlada admin + operador sobre conversaciones de prueba, no de clientes.

3. **DIN-424 — un ciclo WhatsApp de prueba**  
   Tras (1) y con `REENTRY_POLICY=prompt`: bot → toma o handoff → cierre → siguiente mensaje del usuario = prompt de reentrada → continuar o nueva consulta. Verificar un solo TwiML y cursor esperado.

4. **DIN-426 — activar protección**  
   Confirmar en logs `twilio_signature_valid` contra `https://bot.dinamiceducation.com/webhooks/twilio/main-menu`. Recién entonces `TWILIO_SIGNATURE_MODE=enforce` y recrear solo el backend. Validar 403 sintético **sin** body de mensaje real, y un inbound Twilio verdadero en 200. Rollback: volver a `log`.  
   En paralelo, alinear `NODE_ENV=production` en un cambio de config aparte (no bloquea enforce, sí reduce superficie).

Dependencias: 009 → flag de toma → prueba de panel → ciclo de reentrada. Enforce es independiente de 009, pero no debe mezclarse con un deploy de takeover en el mismo cambio.

---

## E. Evidencias faltantes

### Locales (pueden hacerse sin producción)

Ya hechas en esta sesión, no repetir salvo regresión:

- Tests unitarios/HTTP de takeover, reentrada y firma.
- Integración SQL TEST en `tea-bot` (requiere `TB_SQL_TEST_CONFIRM=tea-bot` en el proceso; no escribir `.env`).
- SELECT de `schema_migrations` en `tea-bot`.

Pendiente local opcional (no bloqueante): prueba de panel contra un frontend local apuntando a la API local con el flag on. No se ejecutó (implica login interactivo).

### Producción (solo lectura; no ejecutar POST al webhook inbound si el modo es `log`)

```bash
# Checkout e imágenes
cd /home/nasser/tea-bot && git log -1 --format='%H %s'
docker inspect tea-whatsapp-bot --format '{{.Image}} {{.State.Health.Status}} {{.RestartCount}}'
docker inspect tea-frontend --format '{{.Image}} {{.State.Status}}'

# Flags (no imprimir secretos)
docker exec tea-whatsapp-bot sh -c 'printenv | grep -E "^(MANUAL_TAKEOVER_ENABLED|TWILIO_SIGNATURE_MODE|REENTRY_POLICY|APP_BASE_URL|NODE_ENV|TWILIO_PUBLIC_PATH_PREFIX|DEV_TOOLS_ENABLED)="'
```

```sql
-- En tea_bot, solo lectura
SELECT filename, checksum, success, executed_at
FROM dbo.schema_migrations
ORDER BY filename;

SELECT c.name, TYPE_NAME(c.user_type_id) AS type_name, c.is_nullable,
       OBJECT_DEFINITION(c.default_object_id) AS default_def
FROM sys.columns c
WHERE c.object_id = OBJECT_ID(N'dbo.conversations')
  AND c.name IN (N'reentry_json', N'status_version');

SELECT OBJECT_ID(N'dbo.conversation_operation_requests', N'U') AS operation_requests;
SELECT COL_LENGTH(N'dbo.provider_webhook_events', N'response_body') AS response_body;
```

Pruebas funcionales (requieren autorización; no hechas):

- Panel: login admin → Tomar conversación en `bot` → assigned. Login operador → otra conversación `bot` → assigned. Segundo agente sobre la misma → 409.
- WhatsApp de prueba: cierre humano → siguiente inbound = prompt de reentrada.
- Firma: solo **después** de `enforce`, POST sin `X-Twilio-Signature` debe ser 403. **No hacerlo en `log`:** el turno se procesaría.

---

## F. Resultado para actualizar Google Sheets

| Ticket | Estado de auditoría | Marcar Completado | Sprint recomendado | Justificación |
|---|---|---|---|---|
| DIN-423 | `IMPLEMENTED_PENDING_VALIDATION` | FALSE | Sprint actual (validación panel) | Código y tests locales cubren admin + operador, lock y 409. Falta click productivo y confirmar flag + frontend desplegado. |
| DIN-424 | `IMPLEMENTED_PENDING_VALIDATION` | FALSE | Sprint actual (ciclo WhatsApp) | Ciclo integral verde en SQL TEST. No hay hilo WhatsApp real ni lectura de `REENTRY_POLICY` / 008 en prod. |
| DIN-425 | `IMPLEMENTED_PENDING_VALIDATION` | FALSE | Sprint actual (SELECT prod) | 009 sigue siendo necesaria y está bien en `tea-bot`. 010 no la reemplaza. Esquema productivo no leído hoy. |
| DIN-426 | `PARTIALLY_IMPLEMENTED` | FALSE | Sprint actual (activar `enforce`) | Middleware y tests existen. `log` no rechaza firmas inválidas. Modo prod no confirmado. Healthz vive en `development`. |

Reglas aplicadas: `TRUE` solo para `DONE_VERIFIED`. Ninguno lo es. No se modificó Google Sheets.

---

## Resultado global

**`P0_PENDING_VALIDATION`**

Justificación: los cuatro tickets tienen implementación sustancial en `main` y evidencia local ejecutada en esta sesión (110 unitarias, 25 integraciones SQL, 36 frontend, esquema `tea-bot` 008/009/010). Ninguno tiene validación suficiente en el entorno requerido. DIN-426, además, no cumple el criterio de rechazo de firmas mientras no esté `enforce`. El backend público está arriba (`/health` 200, `environment=development`) pero el commit, los flags y las migraciones productivas quedaron fuera de alcance (SSH `Permission denied`). Cerrar cualquiera hoy sería confundir código presente con comportamiento verificado en producción.
