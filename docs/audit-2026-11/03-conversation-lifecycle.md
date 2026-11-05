# Ciclo de conversación y toma humana

## Estados que el código usa de verdad

No agregar estados nuevos si estos alcanzan.

| Concepto del plan | Representación actual | Confirmado por código |
|---|---|---|
| `BOT_ACTIVE` | `conversations.status = 'bot'` y sin handoff activo | Default SQL y altas en `conversation.service.js` |
| `WAITING_HUMAN` | `status = 'waiting_human'`, handoff `pending` | `human-handoff.service.js` |
| `HUMAN_ACTIVE` | `status = 'assigned'`, handoff `assigned`, `assigned_agent_id` | Claim y envío de agente |
| `REENTRY_PENDING` | `status = 'bot'` **y** `reentry_json.status` en `pending` o `awaiting_choice` | Policy y lifecycle. No es una columna de estado |
| Cierre de inbox | Sigue en `bot`, handoffs `resolved`, sesiones terminadas, reentrada armada si la policy es `prompt` | `returnConversationToBot` |
| `conversations.status = 'closed'` | Simulador y reapertura de inbound | El botón «Cerrar y devolver al bot» **no** lo setea |
| `paused` en conversación | Solo filtro | La sesión SQL sí pasa a `paused` en la derivación |

Decisión de producto todavía abierta, y hace falta antes de codificar un segundo botón: si «cerrar» debe dejar la conversación resuelta sin reabrir el bot, o si el único cierre operativo sigue siendo devolver al bot. Hoy los dos endpoints hacen lo segundo. Hasta que el producto elija, la implementación de toma no inventa un `closed` nuevo.

## Qué pasa hoy

### El bot deriva

El motor marca handoff. `requestHumanHandoff` abre o reutiliza un handoff `pending`, pone `waiting_human`, limpia el agente y pausa la sesión SQL. El inbound siguiente ve `isConversationInHumanMode` o `shouldBlockBotFlow` y persiste el mensaje sin correr el motor (`message-persistence.service.js` líneas 46–64).

### El agente toma la cola

`POST /api/conversations/:id/claim` (`claimConversation`, líneas 152–184):

1. Lee la conversación sin `UPDLOCK`.
2. `closed` → 409.
3. `bot` → 409 `CONVERSATION_BOT_ACTIVE`.
4. `assigned` o `paused` → 200 con la fila actual, aunque el agente sea otro.
5. `waiting_human` → `markAssigned` y handoff `assigned`.
6. WebSocket `conversation.assigned` y `conversation.updated`.

Dos requests paralelos pueden pasar el paso 5. El último `UPDATE` gana. No hay 409 de conflicto.

### El agente escribe

`sendAgentMessage` (líneas 211–311) rechaza `bot` y `closed`. Si está en `waiting_human`, claim implícito. Luego Twilio REST, fila `sender_type = 'agent'` con SID, y `assigned_agent_id` del que envió. Eso reasigna sin auditoría aunque otro agente fuera el dueño.

### Devolver al bot

`close` y `return-to-bot` llaman a `returnConversationToBot` dentro de una transacción con `findByIdForUpdate` (lifecycle líneas 75–151):

- Resuelve handoffs activos.
- Termina sesiones abiertas.
- Si la policy es `prompt` y se vuelve desde humano, escribe `reentry_json` con snapshot. No deja el cursor en `welcome` para que el próximo texto matchee un menú invisible.
- Estado final `bot`, agente null.
- Inserta un mensaje `system` que no sale por Twilio.
- Emite `conversation.returned_to_bot`.
- El reset de memoria ocurre **después** del commit. Si ese reset falla, queda logueado y la base ya volvió a `bot` (líneas 153–168).

El frontend solo usa `close`.

### Reentrada en el inbound

`consumeInbound` corre antes del motor. Puede devolver prompt, retomar, empezar de cero o pedir humano. El pipeline también vuelve a mirar `reentryJson` después del motor (líneas 78–135) para no dejar que una respuesta de menú pise el prompt.

Integración con toma futura: si hay `reentry_json` pendiente y un agente toma, la transacción debe limpiar esa reentrada o marcarla resuelta en el mismo commit. Si no, el próximo inbound puede mandar el prompt de «¿seguimos o empezamos?» mientras un humano ya es dueño. El skip por `assigned` ocurre antes de `consumeInbound` (líneas 46–52), así que con el estado ya en `assigned` el prompt no sale. La limpieza igual conviene para no rearmar el prompt al devolver al bot con un snapshot viejo mal interpretado. `returnConversationToBot` ya conserva una reentrada `pending` si sigue abierta (lifecycle líneas 103–115). La toma tiene que definir ese caso: tomar cancela la pregunta de reentrada porque el humano asume el hilo.

### Carrera que ya existe, aunque nadie pueda tomar un `bot`

1. Llega un mensaje, el motor corre con estado `bot`.
2. El motor decide handoff y todavía no commiteó.
3. El TwiML de ese turno igual se envía: es la respuesta de derivación, y es correcto.
4. En un turno que **no** es handoff, el agente no puede entrar: el claim está prohibido.
5. Cuando el estado ya es `waiting_human`, un inbound nuevo no corre el motor. Un TwiML que ya se estaba armando en el turno anterior no se cancela.

Esa última ventana es la que la toma desde `bot` agranda si se implementa como un `UPDATE` suelto.

## Comportamiento objetivo

Un agente con permiso de toma puede:

1. Abrir cualquier conversación que su rol ya puede listar. Hoy el inbox es compartido: no hay equipos ni empresas. El alcance es «cualquier autenticado», hasta que exista un permiso más fino.
2. Tomarla en `bot`, en cola, o con reentrada pendiente.
3. Dejar el bot callado: `assigned`, sesión de flujo terminada o pausada, sin TwiML posterior iniciado después del commit.
4. Enviar y recibir. El inbound se guarda y no entra al motor.
5. Ver el historial que ya devuelve `GET .../messages`.
6. Devolver al bot por el lifecycle actual, que arma reentrada.
7. No pisar a otro agente. Un segundo claim recibe 409 con el dueño. Un admin con permiso de reasignación usa otro endpoint, con motivo.

No hace falta estado `HUMAN_ACTIVE` nuevo. `assigned` + handoff `assigned` + `assigned_agent_id` alcanzan.

## Diseño de `takeover`

Extender el inbox. No abrir un router paralelo.

`POST /api/conversations/:id/takeover`

```json
{ "reason": "opcional según política", "expectedVersion": null, "clientRequestId": "uuid" }
```

`expectedVersion` sale de una columna nueva `status_version INT NOT NULL DEFAULT 0`, incrementada en cada transición de atención. Es la barrera barata además del lock. Migración propuesta, no escrita en `migrations/`:

```sql
IF COL_LENGTH('dbo.conversations', 'status_version') IS NULL
  ALTER TABLE dbo.conversations
    ADD status_version INT NOT NULL
      CONSTRAINT DF_conversations_status_version DEFAULT 0;
```

Transacción única:

1. Auth en servidor. Permiso `conversation.takeover`. Sin ese permiso, 403 y cero writes. El botón oculto no basta.
2. `BEGIN` y `findByIdForUpdate`.
3. Si `assigned_agent_id` es el mismo actor y el status es `assigned`, responder 200 idempotente. No crear otro handoff.
4. Si hay otro dueño, 409 `{ code: 'CONVERSATION_OWNED', assignedAgentId, assignedAgentLabel }`. No robar.
5. Si `clientRequestId` ya se auditó para esta conversación, devolver el mismo resultado.
6. Pausar o terminar la sesión de flujo abierta. Guardar en la auditoría el `current_node_key` anterior. No borrar mensajes.
7. Si `reentry_json` está `pending` o `awaiting_choice`, ponerla en null dentro del mismo update. El humano tomó el hilo; el prompt no debe dispararse.
8. Si hay handoff `pending` o `assigned` de esta conversación, actualizarlo a `assigned` con este agente. Si no hay handoff activo, insertar uno nuevo con motivo `manual_takeover`. No reabrir filas `resolved`.
9. `status = 'assigned'`, `assigned_agent_id`, `status_version = status_version + 1`.
10. Fila en `audit_logs`: actor, razón, origen `manual_takeover`, estado anterior, estado nuevo, versión, correlation id.
11. Mensaje interno `sender_type = 'system'`, `metadata.event = 'manual_takeover'`, sin llamada a Twilio.
12. `COMMIT`. Después, WebSocket `conversation.assigned`. Si el socket falla, el GET sigue siendo verdad.

`POST /api/conversations/:id/transfer` queda para quien tenga `conversation.reassign`. Misma transacción, exige dueño actual distinto y motivo. No reactiva el bot.

`POST /api/conversations/:id/return-to-bot` ya existe y debe seguir siendo el único camino de vuelta, con la policy de reentrada. `close` permanece como alias hasta la decisión de producto. La UI no ofrece dos nombres para la misma acción.

`GET /api/conversations/:id` agrega, calculado en servidor:

- `canTakeover`
- `takeoverBlock` (`bot_active` deja de ser un bloqueo; `owned_by_other` sí)
- `assignedAgentId`
- `statusVersion`
- `reentryStatus` si hace falta mostrarla

### Barrera contra el TwiML

Dentro de `processLockedInbound`, después de `resolveIncomingMessage` y antes de `handleOutbound` / `buildTwimlMessage`:

1. Abrir transacción corta, `findByIdForUpdate`.
2. Si `status` no es `bot`, o `status_version` cambió respecto de la lectura del inicio del turno, no persistir outbound de bot y devolver `human_mode_skip`.
3. El inbound de ese turno ya debe estar persistido. No se borra.

Carrera residual aceptada y a documentar: Twilio ya recibió un TwiML en un request anterior. No se puede des-enviar. La garantía es: ningún turno **empieza** a construir respuesta automática después del commit de la toma.

El `Map` de `withInboundUserLock` no cumple esto entre procesos ni frente al panel. El panel no entra a esa cola.

### Claim actual

Cuando exista takeover, `claim` de `waiting_human` puede delegar en el mismo caso de uso. Así no quedan dos escrituras distintas. Hasta el corte, el claim viejo sigue para no romper el botón de la cola. El botón de `bot` llama solo a takeover.

### Reinicio

Con el estado en SQL, matar el proceso después del commit conserva `assigned`. `sessions.json` puede seguir diciendo que el usuario está en un nodo: la próxima lectura tiene que obedecer el status SQL y no contestar. Eso ya ocurre si el status es `assigned` al entrar `handleInbound`. Hay que asegurar que un runtime viejo no se use si el status cambió a mitad de turno (la barrera de arriba).

### WebSocket caído

El cliente, al reconectar o al fallar el POST, hace GET. El composer solo se habilita con el cuerpo 200, no con un update optimista.

### Error de base a mitad de toma

La transacción hace rollback. No queda handoff asignado sin status, ni status asignado sin handoff. El cliente ve 500 y la conversación sigue en `bot`.

### Dos agentes

El segundo bloquea en `UPDLOCK` y, al leer, ve al primero. Respuesta 409. Un doble click del mismo agente con el mismo `clientRequestId` es idempotente.

### Conversación ya resuelta

Si el producto sigue sin `closed` real, no hay nada que reabrir: está en `bot` o en humano. Si en el futuro `closed` significa resuelta, la toma la reabre a `assigned` en la misma transacción, reutilizando `conversation-reopen.service.js` solo si ese servicio ya hace el salto. Hoy el reopen está pensado para un inbound sobre `closed`, no para el panel. No llamarlo a ciegas.

### Sesión histórica sin fila activa

La toma igual setea `assigned`. No exige sesión ni handoff previo. Si no hay sesión, no se crea una de bot.

### Agente sin permiso

403. Test de que la fila no cambió `updated_at` ni `status_version`.

## UI

- En `bot` y en reentrada, botón primario «Tomar conversación» si `canTakeover`.
- En `assigned` de otro, texto con el dueño y acción secundaria «Reasignar» solo con permiso. Motivo obligatorio en esa acción.
- Composer deshabilitado hasta el 200.
- Evento de sistema en el timeline, distinto de una burbuja de WhatsApp. El timeline ya distingue `senderType`; hay que rotular `manual_takeover` como evento interno para no contarlo como mensaje enviado.
- Lista: la misma acción, para no obligar a abrir el hilo. Puede ser el segundo PR de UI.

## Casos especiales, resultado esperado

| Caso | Resultado |
|---|---|
| Toma mientras el bot procesa | Una sola respuesta como máximo: la que ya había pasado la barrera de versión, o ninguna si la toma commiteó antes |
| Dos agentes | Un ganador, un 409 |
| Usuario escribe durante el cambio | Mensaje guardado; si el commit de toma ya está, cero menú |
| Reentrada pendiente | Se cancela el prompt; status `assigned` |
| Antes resuelta por return-to-bot | Se puede tomar igual, porque está en `bot` |
| Sin sesión activa | Se toma igual |
| WebSocket caído | GET muestra `assigned` |
| Fallo SQL | Rollback, sigue en `bot` |
| Admin reasigna | Endpoint de transferencia, auditoría, el bot no vuelve |

## Compatibilidad con la reentrada ya escrita

No duplicar `conversation-reentry.service.js`. La toma no llama a `returnConversationToBot`. Al devolver, se usa ese servicio tal cual está. Prueba de regresión obligatoria: takeover → return-to-bot → texto libre → prompt de reentrada, no `fallback_global` (T06).

El test actual que exige `CONVERSATION_BOT_ACTIVE` en claim con reentrada pendiente tiene que cambiar de expectativa cuando claim delegue en takeover, o quedar limitado al endpoint viejo si se mantiene durante el flag.

## Flag de rollout

`MANUAL_TAKEOVER_ENABLED=false` por default.

- Apagado: la ruta responde 404 o 409 controlado y la UI no muestra el botón. Las conversaciones ya tomadas permanecen `assigned` y se atienden con el envío actual.
- No dropear `status_version` en el rollback.

## Criterios de aceptación

Los de T01–T06, T15, T16 y T20 en `10-test-strategy.md`, contra SQL TEST, más una prueba manual con dos sesiones de agente.
