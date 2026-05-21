# Fase 2 — Human handoff (base de datos)

## Qué cambió

- Migración `whatsapp-bot/migrations/002_human_handoffs.sql`: tabla `human_handoffs`, índices en handoffs y `conversations(status, last_message_at)`.
- `HumanHandoffRepository` y `HumanHandoffService` (cola `pending`, pausa de conversación/sesión).
- `ConversationService`: `markWaitingHuman`, `markAssigned`, `markBotActive`, `reloadConversation`, metadata extendida en mensajes outbound.
- Webhook Twilio: si `status` es `waiting_human` o `assigned`, persiste inbound con `botSkipped` y **no** ejecuta FlowEngine; respuesta TwiML vacía.
- Tras FlowEngine, si el resultado indica handoff → crea/reusa `human_handoffs`, `waiting_human`, sesión `paused`, confirma **una vez** por Twilio.
- FlowEngine: terminales `human_handoff` / `fallback_handoff` **no** resetean sesión en memoria; el resultado incluye `requiresHuman` y `terminalReason`.

## Detección de handoff

Se usa `src/utils/handoff-detection.js`:

| Señal | Origen |
|--------|--------|
| `requiresHuman === true` | FlowEngine (terminal o comando global `human` sin nodo) |
| `terminalReason` ∈ `human_handoff`, `fallback_handoff` | Nodo JSON `isTerminal` |
| `currentNodeId` ∈ `human_handoff`, `humano`, `asesor`, `representante` | Nodo alcanzado o fallback del comando |

Texto de confirmación: mensaje del nodo JSON; si viene vacío, default en español (mismo chat, sin otro número).

## Pausa del bot

- **Fuente de verdad:** `conversations.status`
  - `bot` → FlowEngine activo
  - `waiting_human` / `assigned` → inbound guardado, motor omitido
- **Sesión DB:** `conversation_sessions.status = paused` en handoff (no se avanza historial del motor en modo humano).

Idempotencia: un solo `human_handoffs` con `status = pending` por conversación; la confirmación Twilio solo se envía si el estado previo era `bot`.

## Verificación con Twilio (local)

1. `CONVERSATION_DB_ENABLED=true` y SQL Server migrado: `npm run db:migrate` en `whatsapp-bot`.
2. Llegar a un nodo terminal `human_handoff` o enviar comando global de humano (según flujo publicado).
3. Confirmar en DB:
   - `conversations.status = waiting_human`
   - `conversation_sessions.status = paused`
   - fila en `human_handoffs` con `status = pending`
4. Enviar otro mensaje del usuario: debe aparecer en `conversation_messages` con `botSkipped: true`; el webhook no debe devolver menú del bot (TwiML vacío).

## Fase 3 (no implementada)

- Inbox para empleados: listar `waiting_human`, abrir historial, asignar (`assigned`), responder por el mismo número Twilio, cerrar o devolver a `bot`.
