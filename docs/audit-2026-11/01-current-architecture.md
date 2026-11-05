# Arquitectura actual

**Evidencia:** lectura estática del repositorio el 4 de noviembre de 2026.  
**No es** una propuesta de reescritura. Los límites de abajo son los que el código ya tiene.

## Mapa

```text
WhatsApp
  -> POST /webhooks/twilio/:flowId          (sin firma)
  -> adapter canónico (Body; media ignorada si no hay texto)
  -> dedupe archivo o provider_webhook_events si MONITORING_ENABLED
  -> lock en memoria por userId (un solo proceso)
  -> MessagePersistence.handleInbound
       conversación SQL + mensaje inbound
       skip si waiting_human / assigned / handoff activo
       si no: reentrada o FlowEngine
  -> TwiML de respuesta (bot) o TwiML vacío (humano)
  -> SQL conversation_messages (bot sin SID de Twilio)

Panel React
  -> cookie tea_session
  -> /api/conversations (requireAuth, sin permiso por conversación)
  -> claim / send REST / close(=return-to-bot)
  -> WebSocket /api/conversations/live

SQL Server
  conversaciones, mensajes, sesiones, handoffs, flujos, auditoría de flujos,
  eventos de webhook, entregas, incidentes

Memoria + data/sessions.json
  sesión caliente del FlowEngine

Memoria + data/webhook-processed-ids.json
  dedupe histórico cuando el gate SQL no trackea
```

No hay un `conversation_epoch`. La autoridad de «el bot puede responder» es `conversations.status` más un handoff activo, leída al **inicio** del turno. Después del motor no se vuelve a consultar ese estado antes de armar el TwiML (`twilio-inbound-pipeline.js` líneas 151–160, `twilio-webhook.controller.js` líneas 148–161).

## Backend

Raíz de ejecución: `whatsapp-bot/src/app.js`.

| Módulo | Responsabilidad | Límite |
|---|---|---|
| `adapters/twilio` | Payload Twilio ↔ evento interno y TwiML | No decide negocio |
| `controllers/twilio-webhook.controller.js` | Gate de dedupe, vacío sin texto, TwiML de error | No debe poseer reglas de handoff |
| `services/twilio-inbound-pipeline.js` | Orden: persistir, motor, reentrada, handoff, outbound | Lock solo de proceso |
| `services/flow-engine.service.js` | Transiciones y texto del nodo | No conoce claim ni Twilio |
| `services/message-persistence.service.js` | Cuándo saltar el motor y qué guardar | `safeRun` traga errores si `required` es falso |
| `services/conversation.service.js` | Alta, mensajes bot/user, sync de sesión | Mezcla persistencia y runtime |
| `services/human-handoff.service.js` | Derivación del motor a cola | No ofrece toma desde `bot` |
| `services/conversation-inbox.service.js` | Lista, claim, envío de agente, cierre | Sin transacción de claim |
| `services/conversation-bot-lifecycle.service.js` | Volver a `bot` y armar reentrada | Sí usa `UPDLOCK` |
| `services/conversation-reentry.service.js` | Prompt y elección post-cierre | Flag `REENTRY_POLICY` |
| `services/session.service.js` | Mapa en memoria y `sessions.json` | Sigue en el camino caliente |
| `repositories/*` | SQL | `findByIdForUpdate` existe y el inbox no lo usa |
| `monitoring/*` | Salud, saldo, entregas, acquire de webhooks | Observa; hoy también habilita la exclusión |
| `realtime/conversation-live.ws.js` | Fan-out al inbox | No es autoridad de estado |
| `auth` + middleware | Cookie firmada, roles `admin` y `conversations_only` | Usuarios en entorno, no en SQL |

### Endpoints montados

Confirmado en `app.js` y los routers:

| Prefijo | Auth |
|---|---|
| `GET /health`, `GET /healthz` | Ninguna. `/health` no toca la base. `/healthz` mira config Meta y flujo publicado. No hay `/readyz`. |
| `GET|POST /webhook` | Meta. Sin firma. |
| `POST /webhooks/twilio/:flowId` | Sin firma. |
| `POST /webhooks/twilio/:flowId/status` | `verifyTwilioSignature`. |
| `/api/auth/login\|me\|logout` | Login público; sesión cookie. |
| `/api/conversations` | `requireAuth`. |
| `/api/flows`, `/api/flow-management`, `/api/simulator`, `/api/monitoring` | `requireAuth` + `requireAdmin`. |
| `/api/dev/conversations/inbound-message` | Admin y no producción, salvo `DEV_TOOLS_ENABLED`. |
| WebSocket `/api/conversations/live` | Cookie válida. Sin chequeo de rol. |

Inbox (`conversations.routes.js`):

- `GET /`
- `GET /:id`, `GET /:id/messages`
- `POST /:id/claim`, `POST /:id/messages`, `POST /:id/close`, `POST /:id/return-to-bot`
- `PATCH /:id/contact`

No existen `POST /takeover` ni `POST /transfer`. `close` y `return-to-bot` llaman al mismo `_returnConversationToBot` (`conversation-inbox.service.js` líneas 343–348 y 395–400).

### Configuración que cambia comportamiento

| Variable | Default en código | Efecto |
|---|---|---|
| `MONITORING_ENABLED` | `false` (`config.js`) | Si es falso, no se usa `acquireInboundProcessing`. |
| `REENTRY_POLICY` | `prompt` si la variable falta | `legacy` restaura el cursor viejo. Sin columna `reentry_json`, el modo pasa a `degraded`. |
| `CONVERSATION_DB_ENABLED` | apagado salvo valor verdadero | Sin base, el inbox no opera. |
| `FLOW_STORAGE_MODE` | `db` | Flujos publicados desde SQL. |
| `CONVERSATION_CLASSIFICATION_MODE` | `legacy` en config; example `shadow` | Clasificación y Sheets, aparte del inbox. |

No existe `TWILIO_SIGNATURE_MODE`.

## Frontend

React + Vite + MUI + React Query. Rutas en `frontend/src/app/router.tsx`.

| Ruta | Quién entra |
|---|---|
| `/login` | Público |
| `/conversations`, `/conversations/:id` | Cualquier sesión |
| `/flows`, editor de conversación | Admin |
| `/monitoring` | Admin |
| Resto | Admin a flujos, operador a conversaciones |

`ConversationsPage` concentra lista, filtros, detalle, claim, envío, cierre, nombre de contacto, sidebar redimensionable y eventos en vivo. Filtros reales: texto, estado (`bot`, `waiting_human`, `assigned`, `closed`, `paused`) y canal. No hay filtro de estancadas, mías, ajenas ni error de entrega.

`ConversationComposer` (`líneas 85–116`): en `bot` muestra un aviso y no ofrece toma. El botón «Tomar conversación» solo aparece en `waiting_human`. En `assigned` cualquier operador puede escribir (`agentAssignment.ts` líneas 18–20). No hay composer de archivos.

El cliente HTTP no llama a `return-to-bot`. El botón visible es «Cerrar y devolver al bot» (`ConversationDetail.tsx` línea 147) y pega a `POST .../close`.

WebSocket: `useConversationsLiveUpdates` contra `/api/conversations/live`. Eventos de servidor: `conversation.created`, `updated`, `message.created`, `assigned`, `closed`, `returned_to_bot`. El inbox emite `returned_to_bot` al cerrar, no `closed`. `closed` aparece en el simulador.

Editor de flujos y simulador admin existen y publican versiones con validación estructural más `compileFlow`. Eso queda fuera del gap de inbox, salvo el lint de colisiones que todavía no está.

## Base de datos

Migraciones forward-only `001` … `008` en `whatsapp-bot/migrations/`. No hay tabla de usuarios.

| Tabla | Para qué sirve hoy |
|---|---|
| `conversations` | Estado de atención, cursor de flujo, agente, email, `reentry_json` |
| `conversation_messages` | Cuerpo, dirección, `sender_type`, `provider_message_id` opcional, JSON |
| `conversation_sessions` | Sesión de flujo en SQL, incluido `tracking_json` |
| `human_handoffs` | `pending`, `assigned`, `resolved` |
| `flows` y versiones, nodos, transiciones, snapshots | Publicación |
| `audit_logs` | Cambios de flujos y retención. La toma de conversación no escribe aquí |
| `provider_webhook_events` | Lease de inbound cuando el monitoreo está prendido |
| `message_delivery_status` | Callback de estado por SID |
| `monitoring_incidents`, `monitoring_job_status`, `monitoring_balance_samples` | Operación |
| `conversation_classifications`, exports, batches | Sheets / clasificación |

Índices útiles ya presentes: único `(channel, external_user_id)`, mensajes por conversación y fecha, único filtrado de `provider_message_id`, único de webhook `(provider, event_type, provider_message_id)`, índice `(created_at, direction)`.

No hay CHECK de `conversations.status`. Los valores los impone la aplicación. `paused` está en el filtro del inbox y no se encontró un update de producción que lo asigne. `closed` lo usa el simulador y el reopen; el cierre del agente deja `status = 'bot'`.

No hay columnas de adjuntos, de transporte (`twiml|rest|internal`), de época de estado ni de señales de atasco. No hay índice FULLTEXT.

Concurrencia existente:

- `findByIdForUpdate`: `UPDLOCK, ROWLOCK` (`conversation.repository.js` líneas 62–68). Lo usan reentrada, vuelta al bot y reapertura.
- Handoffs activos también se bloquean en su repositorio.
- `HOLDLOCK` no aparece.
- `withInboundUserLock` es una cola en memoria por proceso (`inbound-user-lock.js` líneas 1–23).
- El claim lee la fila sin lock y luego hace `UPDATE` (`conversation-inbox.service.js` líneas 152–184).

## Límites que conviene conservar

- Adapter Twilio separado del motor.
- Repositorios SQL separados de los servicios.
- Publicación de flujos por versión, con compile en la validación.
- `returnConversationToBot` transaccional y la policy de reentrada.
- Monitoreo como lectura operativa, el día que deje de ser la llave de la idempotencia.
- Dos roles ya desplegados en código (`admin`, `conversations_only`) en lugar de inventar un IAM nuevo.

## Dónde hay demasiadas responsabilidades

Esto no justifica microservicios. Son los puntos donde el próximo cambio puede romper otra cosa si se mete en el mismo archivo:

| Pieza | Qué mezcla | Cuándo separarla |
|---|---|---|
| `conversation-inbox.service.js` | Lista, permisos implícitos, Twilio REST, cierre y contacto | Al agregar takeover: caso de uso propio que reutilice repositorios y lifecycle |
| `twilio-inbound-pipeline.js` + controller | Dedupe, motor, reentrada, TwiML, mensaje de error | Al agregar la barrera previa al TwiML |
| `flow-engine.service.js` | Normalización, matching, sesión, fallback, handoff | Al cambiar matching: función de normalización y razón de transición, sin reescribir el motor |
| `ConversationsPage` | Layout, datos, acciones | Al sumar toma y señales: acciones y filtros, no un rewrite de la página |
| `monitoring.service.js` | Salud, Twilio, conciliación de SID, incidentes | El dashboard de costos debe ser otro servicio. No inflar este |

Redis, Kafka, CQRS o varios deployables no tienen un caso demostrado en este repositorio.
