# Tea Bot — Auditoría de estado al 10/11/2026

**Rol:** diagnóstico de avance contra el Plan Técnico Integral v1.1 del 04/11/2026.  
**HEAD local:** `06f26d8` (8/11/2026), un commit por delante de `origin/main` `9b2ff0b` (5/11/2026). Working tree limpio.  
**No se modificó** código, migraciones, flags ni infraestructura.

Atributos usados en el informe: `IMPLEMENTED`, `TESTED`, `INTEGRATED`, `DEPLOYED`, `ENABLED`, `VALIDATED_PRODUCTION`. Son independientes. Un test verde no despliega. Un merge a `main` local no demuestra que el servidor lo esté corriendo.

Detalle de pruebas, Git y SQL: `tea-bot-validation-evidence.md`.  
Matriz ampliada: `tea-bot-audit-matrix.md`.  
P0 abiertos: `tea-bot-p0-remaining.md`.  
Orden de trabajo: `tea-bot-roadmap-updated.md`.

## A. Resumen ejecutivo

Tea Bot sigue siendo un monolito Node.js, con panel React, SQL Server y Twilio WhatsApp. El camino de webhook, flujos versionados, inbox, handoff y WebSocket está integrado en el código que ya está en `origin/main`.

La reentrada posterior al cierre humano está **implementada e integrada** en ese código. En la base local `tea-bot` la migración 008 está aplicada desde el 4/11, y el 10/11 sus pruebas unitarias y de integración SQL pasaron. No hay evidencia de que el proceso que atiende WhatsApp tenga la columna ni `REENTRY_POLICY=prompt`. Queda `IMPLEMENTED` + `TESTED` en local, `DEPLOYED` y `VALIDATED_PRODUCTION` sin verificar.

La toma manual (TB-002, TB-003, TB-004 y el duplicado TB-019) está **implementada** en el commit local `06f26d8`, con tests de dobles en verde. **No está en `origin/main`**, no está pusheada, la migración 009 no está aplicada ni en la base local, y `MANUAL_TAKEOVER_ENABLED` sale apagado. No está habilitada ni desplegada. Las dos pruebas de exclusión en SQL Server hacen skip.

Lo que el plan pide como integridad del webhook **sigue abierto** en el código de `origin/main` y también en el commit local: el inbound no valida `X-Twilio-Signature`, y la idempotencia SQL solo corre si el monitoreo está activo. El default de código es apagado. En el `.env` local esa variable no está definida. Las contraseñas siguen siendo SHA-256 sin salt. No hay CI.

**Avance orientativo de la primera etapa** (seguridad, confiabilidad del procesamiento y estabilidad operativa), con la rúbrica de la sección C:

| Dimensión | Resultado |
|---|---|
| Implementación | **41%** |
| Validación | **33%** |
| Despliegue | **NO DETERMINABLE** |

El 41% y el 33% miden los ocho bloques de la primera etapa, no la cantidad de archivos. El despliegue no se puede porcentuar: este repositorio no dice qué commit corre en el servidor. Sí se sabe que la toma no está en `origin/main`.

**Cerrado en código, pendiente de entorno:** reentrada; firma del callback de estado; tablas de monitoreo 007; toma escrita y apagada.

**Sigue abierto:** firma del inbound, idempotencia siempre activa, hash con salt, prueba SQL de la toma, CI, sesiones con `sessions.json` como autoridad del turno, `/livez` y `/readyz`, multimedia, dashboard mensual y costos Twilio/Meta.

**Riesgos críticos:** un reintento de Twilio puede perderse porque el archivo de dedupe se escribe antes de terminar el turno; un POST al inbound no necesita firma; encender la toma sin la migración 009 hace que el bot deje de autorizar respuestas de filas persistidas.

**Preparación de despliegue:** la toma no está lista para merge ni para activar el flag. El propio informe del 8/11 lo dice, y el estado de la base local lo confirma. El resto de los P0 de integridad tampoco tiene un pipeline que los proteja.

## B. Matriz de cumplimiento

TB-019 es el mismo cambio que TB-002, TB-003 y TB-004.

| Ticket | Prioridad | Estado | Evidencia | Tests | Migración | Deploy | Pendiente |
|---|---|---|---|---|---|---|---|
| TB-001 | P0 | `IMPLEMENTED_PENDING_VALIDATION` | Reentrada `prompt`, `returnConversationToBot`, 008 | Unitario e integración SQL local en verde | 008 aplicada en local. Producción `NOT_VERIFIED` | En `origin/main`. Deploy `NOT_VERIFIED` | E2E del proceso real. `close` y `return-to-bot` hacen lo mismo |
| TB-002 | P0 | `IMPLEMENTED_PENDING_VALIDATION` | `ConversationTakeoverService`, `POST /takeover` | Unitarios en verde. SQL skip | 009 en repo, no aplicada | Solo `06f26d8`, no pusheado | Base `test` y las dos pruebas |
| TB-003 | P0 | `IMPLEMENTED_PENDING_VALIDATION` | Turn guard en la misma transacción que el outbound | Dobles en verde. `UPDLOCK` real no corrido | 009 | Solo local | Carrera SQL y ventana posterior al commit |
| TB-004 | P0 | `PARTIALLY_IMPLEMENTED` | Botón, composer, conflicto, WebSocket. `POST /transfer` sin UI | 28 pruebas de frontend y typecheck en verde | 009 | Solo local | Reasignar en la UI y prueba de dos sesiones |
| TB-005 | P0 | `PARTIALLY_IMPLEMENTED` | Firma solo en el callback de estado | Test del callback | Ninguna | Callback en `origin/main`. Inbound sin firma | Modo `log`, después `enforce` |
| TB-006 | P0 | `PARTIALLY_IMPLEMENTED` | `acquireInboundProcessing` detrás de `MONITORING_ENABLED` | Acquire SQL local en verde. Flag apagado sin prueba | 007 aplicada en local | Código en `origin/main`. Flag productivo `NOT_VERIFIED` | Always-on y marcar al final |
| TB-007 | P0 | `PARTIALLY_IMPLEMENTED` | SHA-256 sin salt. Roles admin y operador. Token sin rol = admin | Auth unitaria en verde | Ninguna de rehash | En `origin/main` | Rehash al login |
| TB-008 | P1 | `NOT_STARTED` | El motor devuelve el motivo y no lo persiste | No | No | No | Shadow de transiciones |
| TB-009 | P1 | `NOT_STARTED` | Sin alerta de atasco | No | No | No | Después de TB-008 |
| TB-010 | P1 | `PARTIALLY_IMPLEMENTED` | Acentos en comandos globales. El motor usa substring | Tests de comandos globales | No | En `origin/main` | Keycaps y frontera de palabra en el motor |
| TB-011 | P1 | `PARTIALLY_IMPLEMENTED` | Validación estructural al publicar | Tests de entry y nodos duplicados | No | En `origin/main` | Colisiones y auto-transiciones |
| TB-012 | P1 | `PARTIALLY_IMPLEMENTED` | SQL hidrata. `sessions.json` sigue en el turno | Tests de sesión | 001 en local | `NOT_VERIFIED` | Cutover |
| TB-013 | P1 | `PARTIALLY_IMPLEMENTED` | `/health`, `/healthz`, actividad. Sin `/livez` ni `/readyz` | Tests de monitoreo en la suite | No | `/health` en `origin/main` | Readiness de base |
| TB-014 | P1 | `PARTIALLY_IMPLEMENTED` | `sender_type` y SID solo en REST de agente | Tests de persistencia | No de transporte | `NOT_VERIFIED` | `twiml` / `rest` / `internal` |
| TB-015 | P1 | `NOT_STARTED` | Conciliación corta de SID, no el informe de 1.024 | Tests del monitor | 007 en local | `NOT_VERIFIED` | Informe diario |
| TB-016 | P2 | `NOT_STARTED` | Email existe. Intención inicial no | Tests de email | 005 en local | `NOT_VERIFIED` | Después de medir |
| TB-017 | P2 | `NOT_STARTED` | Sin refactor de separación | No | No | No | Solo junto a un feature |
| TB-018 | P3 | `NOT_STARTED` | Sin `ContentSid` | No | No | No | Con demanda operativa |
| TB-019 | P0 | `IMPLEMENTED_PENDING_VALIDATION` | Duplicado de TB-002/003/004 | Los de la toma | 009 no aplicada | Solo local, flag apagado | No reimplementar |
| TB-020 | P1 | `NOT_STARTED` | Sin texto, el inbound se descarta. Sin adjuntos | No | No | No | Recibir y ver |
| TB-021 | P1 | `NOT_STARTED` | Composer de texto | No | No | No | Después de TB-020 |
| TB-022 | P1 | `PARTIALLY_IMPLEMENTED` | `LIKE` de teléfono, nombre y cuerpo. UI dice «Teléfono o nombre» | Tests de listado | Sin FULLTEXT | `NOT_VERIFIED` | Fragmento y salto al mensaje |
| TB-023 | P1 | `NOT_STARTED` | Monitor de 15m/60m/24h, no panel mensual | Test de página no reejecutado hoy | 007 | `NOT_VERIFIED` | Mes, serie diaria, CSV |
| TB-024 | P1 | `NOT_STARTED` | Saldo de cuenta, sin Usage Records | No | No | No | Twilio y Meta separados |

Fuentes que no estaban como archivo propio: el plan v1.0 separado y la auditoría histórica de 13 páginas. `docs/audit-2026-11/` es la auditoría del 4/11 y queda desactualizada en la toma.

## C. Primera etapa

Definición: seguridad, confiabilidad del procesamiento y estabilidad operativa.

Cada bloque se puntuó 0, 0.25, 0.5, 0.75 o 1 según cuánto del criterio de aceptación está en el código (implementación) y cuánto se ejecutó en esta auditoría (validación). El promedio de los ocho es el porcentaje.

| Bloque | Implementación | Validación | Despliegue | Estado | Riesgo | Dependencias | Criterio de cierre que falta |
|---|---:|---:|---|---|---|---|---|
| 1. Reentrada y toma | 0.75 | 0.55 | `NOT_VERIFIED` / toma no está en origin | Reentrada integrada y probada en local. Toma escrita, apagada, fuera del remoto | Encender el flag sin 009 corta las respuestas automáticas de filas persistidas | 008 ya en local. 009 no | E2E real de reentrada. Base `test`, 009, dos agentes, flag apagado en el merge |
| 2. Concurrencia y estados | 0.70 | 0.40 | Igual que la toma | Guard transaccional en código. Lock de proceso sigue. Motor escribe memoria antes del guard | Carrera SQL no medida. Ventana TwiML posterior al commit, aceptada por diseño | TB-002 y 009 | `UPDLOCK` concurrente en verde. Reinicio con la columna creada |
| 3. Firma Twilio | 0.25 | 0.30 | Callback en origin, inbound `NOT_VERIFIED` | Status firmado. Inbound abierto. Sin modo `log` | Webhook falso. `enforce` con URL mala corta el canal | `APP_BASE_URL` y el proxy | Muestra en `log`, después `enforce` con vuelta atrás por flag |
| 4. Idempotencia SQL | 0.40 | 0.50 | Código 007 en origin. Flag productivo `NOT_VERIFIED` | Acquire existe y pasó en local con la base prendida. El controlador lo saltea si el monitoreo está apagado | Retry perdido o duplicado | 007. En local está | T09 con el flag apagado. Marcar el SID al final del turno |
| 5. Auth y RBAC | 0.35 | 0.30 | En origin, `NOT_VERIFIED` el entorno | Dos roles. Toma mira la cuenta configurada. Hash sin salt. Token viejo es admin | Secreto filtrado y cookie legacy | Decisión bcrypt o Argon2 | Rehash en el login. Token sin rol deja de ser admin |
| 6. Sesiones | 0.35 | 0.20 | `NOT_VERIFIED` | SQL hidrata. El turno sigue en `sessions.json` | Reinicio parcial o toma que pierde contra una escritura de memoria | Después de la idempotencia | Borrar el JSON en una base de prueba no cambia el siguiente turno |
| 7. Health y observabilidad mínima | 0.40 | 0.25 | `/health` en origin | Proceso vivo y flujo en `/healthz`. La base caída sigue “sana” para Docker | Un deploy queda ready con SQL caído | Ninguna de producto | `/livez` y `/readyz` distintos |
| 8. CI y validación de deploy | 0.10 | 0.15 | No hay pipeline | Tests locales existen. Nada bloquea el merge. No hay registro del commit desplegado | Se puede publicar el inbound sin firma y la toma sin 009 | Repo remoto | Workflow de lint, typecheck, tests y build |

**Implementación:** (0.75+0.70+0.25+0.40+0.35+0.35+0.40+0.10) / 8 = **0.41**.  
**Validación:** (0.55+0.40+0.30+0.50+0.30+0.20+0.25+0.15) / 8 = **0.33**.  
**Despliegue:** `NO DETERMINABLE`.

## D. Hallazgos técnicos

Ordenados por gravedad. La certeza va al lado del título.

### 1. El dedupe de archivo ocurre antes de terminar el turno — defecto confirmado — P0

- **Archivo:** `whatsapp-bot/src/controllers/twilio-webhook.controller.js`, `openMonitoringGate` y `receiveTwilioMessage`.
- **Evidencia:** si `config.monitoringEnabled` es falso, o si `beginInboundEvent` lanza, el gate vuelve `tracked: false`. Las líneas que llaman `webhookDedupe.markProcessed` corren antes de `processCanonicalTwilioInbound`.
- **Escenario:** error de motor o de base después de marcar el `MessageSid`. Twilio reintenta. El proceso ignora el duplicado.
- **Impacto:** el mensaje queda sin respuesta y el retry no lo recupera. Con monitoreo apagado, dos procesos no comparten la exclusión SQL.
- **Corrección:** adquirir en `provider_webhook_events` siempre. Completar o fallar al final. El archivo deja de decidir.

### 2. El inbound de WhatsApp no verifica la firma — defecto confirmado — P0

- **Archivo:** `whatsapp-bot/src/routes/twilio-webhook.routes.js`, `receiveTwilioMessage`. Middleware en `verify-twilio-signature.js`.
- **Evidencia:** `verifyTwilioSignature` está en `POST /:flowId/status`. El `POST /:flowId` no lo usa. El comentario del route lo deja escrito.
- **Escenario:** un cliente que conoce la URL pública envía `From` y `Body`.
- **Impacto:** el motor y la persistencia corren para un evento que Twilio no emitió.
- **Corrección:** modo `log` y, con la URL ya comparada, `enforce`.

### 3. Encender la toma sin 009 cambia el comportamiento del bot — defecto confirmado de operación — P0

- **Archivo:** `conversation-turn-guard.service.js`, `authorizeAutomaticReply`. `conversation.repository.js`, `assertTakeoverSchema` y `updateConversation`.
- **Evidencia:** con el flag activo, una fila persistida sin `status_version` devuelve `INDETERMINATE`. El webhook entonces manda TwiML vacío. La toma responde `TAKEOVER_SCHEMA_REQUIRED`. La base local no tiene la columna.
- **Escenario:** alguien exporta `MANUAL_TAKEOVER_ENABLED=true` y reinicia sobre `tea-bot` o sobre producción si 009 no está.
- **Impacto:** las respuestas automáticas de conversaciones ya persistidas se suprimen.
- **Corrección:** no encender el flag. Aplicar 009 solo en una base aislada hasta ver las dos pruebas en verde.

### 4. La exclusión entre dos agentes no está probada en SQL Server — no verificable — P0

- **Archivo:** `conversation.repository.js`, `findByIdForUpdate` (`UPDLOCK, ROWLOCK`). Tests en `conversation-takeover.integration.test.js`.
- **Evidencia:** el 10/11 esas dos pruebas hicieron skip porque `DB_NAME` es `tea-bot`.
- **Escenario:** dos requests de toma al mismo tiempo.
- **Impacto:** el código está escrito para un ganador. Sin la prueba, el doble dueño sigue siendo un riesgo probable.
- **Corrección:** base cuyo nombre contenga `test`, migrar 009, correr las pruebas.

### 5. El motor avanza `sessions.json` antes de autorizar la respuesta — riesgo probable — P0 de la toma

- **Archivo:** `flow-engine.service.js`, `updateSession`. `twilio-inbound-pipeline.js`, orden engine y después `handleOutbound`. `conversation-takeover.service.js`, `_resetRuntime`.
- **Evidencia:** la autorización mira SQL y puede suprimir el TwiML. La escritura de memoria del motor ya ocurrió. `_resetRuntime` corre cuando la toma commitea, no cuando el motor termina.
- **Escenario:** la toma entra mientras el motor escribe la sesión. El WhatsApp no recibe menú. Al devolver al bot, la memoria puede no coincidir con la sesión SQL pausada.
- **Impacto:** cursor equivocado en el retorno, no un segundo menú inmediato, porque el estado `assigned` saltea el motor.
- **Corrección:** al devolver al bot, la hidratación desde SQL tiene que ganar sobre el archivo. Eso es parte de TB-012 y del E2E de retorno. No es un motivo para rediseñar la toma.

### 6. Hash de contraseña sin salt y token legacy admin — defecto confirmado — P0

- **Archivo:** `admin-auth.service.js`, `verifyPasswordHash`. `roles.js`, `normalizeSessionRole`. `config.js`, `validateConfig`.
- **Evidencia:** el digest es SHA-256 del texto plano. Un payload sin `r` vuelve como `admin`. La toma no usa ese rol: `actorFromAdminUser` llama `resolveEnabledPanelAgent`.
- **Escenario:** copia del `.env`, o una cookie emitida antes de existir el campo de rol.
- **Impacto:** acceso de admin al panel. La toma, si estuviera encendida, seguiría exigiendo una cuenta configurada.
- **Corrección:** rehash progresivo. El cambio del token legacy va separado porque corta sesiones vigentes.

### 7. `INTERNAL_AGENT_ID` ignora el usuario — defecto confirmado, inactivo en local — P1

- **Archivo:** `agent-identity.js`, `resolveAgentIdFromUsername`.
- **Evidencia:** si la variable tiene valor, la función retorna ese UUID y no mira el username. El `.env` local no la define.
- **Escenario:** la variable queda definida en un entorno con admin y operador.
- **Impacto:** un solo `assigned_agent_id`. El 409 de “otro agente” no distingue cuentas.
- **Corrección:** derivar el id del username también cuando la variable existe, o eliminarla antes de encender la toma.

### 8. `close` y `return-to-bot` son la misma transición — confirmado — P1 de producto

- **Archivo:** `conversation-inbox.service.js`, `closeConversation` llama `_returnConversationToBot`.
- **Evidencia:** las dos rutas dejan `status=bot` y arman reentrada. No hay estado de cierre distinto.
- **Escenario:** un agente cree que cerró el caso y el próximo mensaje del usuario vuelve al bot.
- **Impacto:** la reentrada evita el fallback falso. No distingue “resuelto” de “devuelto”.
- **Corrección:** decisión de producto. No hace falta otro bugfix del fallback.

### 9. Webhook de Meta sin firma — defecto confirmado — P1

- **Archivo:** `webhook.controller.js`, `receiveMessage`.
- **Evidencia:** verifica el token de suscripción en el GET. El POST no valida `X-Hub-Signature`.
- **Escenario:** el canal productivo es Twilio. La ruta igual está montada.
- **Impacto:** si esa URL es alcanzable, procesa mensajes sin firma de Meta.
- **Corrección:** fuera del P0 de Twilio. Desmontar o firmar antes de usar el canal.

### 10. Matching por substring y sin keycap en el motor — defecto confirmado — P1

- **Archivo:** `flow-engine.service.js`, `normalizeMessage` y la rama `matchIncludes`. `global-commands.js` sí quita acentos. `stripKeycapDigits` está en la policy de reentrada.
- **Escenario:** una opción `si` puede coincidir dentro de `inscripciones`. `2️⃣` no equivale a `2` en el menú.
- **Impacto:** bucles de menú como los citados en el plan. No se reprodujo una conversación real en esta auditoría.
- **Corrección:** TB-010, con flag de vuelta al matching anterior y replay del flujo publicado.

### 11. Log del teléfono crudo — defecto confirmado — P2

- **Archivo:** `twilio-webhook.controller.js`, `console.log('Twilio From:', req.body?.From)`.
- **Impacto:** PII en logs del proceso.
- **Corrección:** sacar ese log en el mismo cambio de TB-006.

### 12. Multimedia, búsqueda usable, panel mensual y costos — no iniciados como producto — P1 del plan, fuera del cierre inmediato

La búsqueda por cuerpo ya existe como `LIKE`. El placeholder no lo dice. El monitor muestra saldo y ventanas cortas, no el mes ni Usage Records. Un WhatsApp solo con imagen no entra al inbox. Nada de esto bloquea la corrección de firma e idempotencia.

## E. Estado de Git y despliegues

| Superficie | Hecho observado |
|---|---|
| Código local | `main` en `06f26d8`. Limpio. Incluye la toma, 009 y los informes de review. |
| `origin/main` | `9b2ff0b` del 5/11. Tiene reentrada, 007 y 008 en el repo. No tiene la toma. |
| Merge | El commit local no fue pusheado ni mergeado al remoto. |
| Migraciones en Git | 001 a 009. |
| Migraciones en local `tea-bot` | 001 a 008 con `success=true`. 009 ausente. `reentry_json` presente. `status_version` ausente. |
| CI | No hay workflow. |
| TEST | No hay base con `test` en el nombre. Las integraciones de reentrada escribieron y limpiaron fixtures en `tea-bot` durante la suite del 10/11. |
| Producción | `NOT_VERIFIED`. El Dockerfile del frontend tiene por default `http://170.239.85.196:3000`. No se consultó ese host. Nginx del frontend no configura el webhook. El healthcheck del bot pega a `/health`, que no mira la base. |

Flags efectivos en el `.env` local: persistencia SQL encendida, flujos en DB, clasificación `shadow`, toma sin definir (apagada), reentrada sin definir (default `prompt`), monitoreo sin definir (apagado).

## F. Roadmap actualizado

El detalle de archivos, tests y aceptación está en `tea-bot-roadmap-updated.md`. Orden:

1. **E0.** Dejar la toma apagada. No desplegar `06f26d8` con el flag encendido.
2. **E1.** Base aislada, aplicar 009, ver en verde las dos pruebas SQL. Recién después el commit puede ir a `origin` con el flag apagado. Bloqueado por la base.
3. **E2.** TB-006, idempotencia siempre activa. Ejecutable ahora, en una rama que no encienda la toma.
4. **E3.** TB-005 en modo `log`. Ejecutable en paralelo con E2. `enforce` queda bloqueado hasta medir la URL.
5. **E4.** TB-007, rehash al login.
6. **E5.** `/livez` y `/readyz`.
7. **E6.** CI. El job con SQL espera E1.

Después de esa etapa: señales en shadow, matching con replay, búsqueda sobre el `LIKE` actual, transporte y costos, medios, y al final sesiones como única autoridad y templates proactivos.

## G. Próxima acción recomendada

**Implementar TB-006: que `acquireInboundProcessing` decida el inbound aunque `MONITORING_ENABLED` esté apagado, y que el `MessageSid` se marque recién al terminar el turno.**

Es el siguiente cambio de código porque el defecto ya está en `origin/main`, en el commit local y en el default del proceso. Puede perder un reintento hoy, sin depender de la toma. La toma ya está escrita: ampliarla no cierra la primera etapa, y encenderla sin 009 es el peor despliegue disponible. La firma va enseguida, en modo `log`, en el mismo bloque de hardening. `enforce` espera una muestra de URL.

En paralelo, sin código de producto, hace falta una base local cuyo nombre contenga `test` para aplicar 009 y correr las dos pruebas que hoy hacen skip. Eso destraba el merge del commit que ya existe. No es una implementación nueva.

---

**Qué está terminado en código:** reentrada, firma del status, esquema de monitoreo, y la toma manual apagada en un commit local.  
**Qué falta corregir:** idempotencia always-on, firma del inbound, hash, prueba SQL de la toma, readiness y CI.  
**Qué se puede implementar ahora para cerrar la primera etapa:** TB-006, y después el modo `log` de TB-005, sin activar la toma y sin aplicar 009 sobre `tea-bot`.
