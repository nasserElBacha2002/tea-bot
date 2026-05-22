# DoD — Simulador visible en `/conversations`

**Fecha:** 2026-05-22  
**Estado final:** `SIMULATOR_TO_CONVERSATIONS_FLOW_FIXED`

---

## Causa raíz

El simulador ejecutaba el **FlowEngine solo en memoria** (`sessionService`) sin pasar por `conversationRepository` ni emitir eventos live. La bandeja lee DB + WebSocket → siempre vacía para pruebas del editor.

---

## Cambios realizados

### Simulador (`simulator.service.js`)

- Tras cada `start` / `message` / `reset`, delega en `simulator-persistence.service.js`.
- En modo humano (`waiting_human` / `assigned`), persiste inbound sin re-ejecutar motor.

### Persistencia (`simulator-persistence.service.js`)

- `findOrCreateSessionConversation` por `simulator:{sessionId}`.
- Mensajes user/bot, sesión DB, handoff vía `humanHandoffService`.
- `closeSessionConversation` al reiniciar.
- Eventos realtime en cada cambio.

### WebSocket

- Sin eventos nuevos; mismos tipos que Twilio.

### Frontend

- `useConversationSimulator`: nuevo `sessionId` al reiniciar prueba.
- `applyConversationLiveEvent`: `invalidateQueries` si llega `created` / mensaje sin summary completo.

### Listado

- Sin cambio de filtros: simulator visible por defecto en dev.
- Filtro **Canal → Simulador** sigue funcionando.

### Dev tools

- `POST /api/dev/conversations/inbound-message`
- `npm run conversations:simulate-message -- "texto"`

---

## Cómo probar sin WhatsApp

```bash
# Terminal 1
cd whatsapp-bot && npm run dev

# Terminal 2 — script (requiere login en .env)
npm run conversations:simulate-message -- "Hola"

# O desde el editor: Probar conversación → enviar mensajes → /conversations
```

### Diagnóstico rápido

| Síntoma | Capa |
|---------|------|
| No aparece ni con Actualizar | DB / persistencia / filtros |
| Aparece con Actualizar, no en vivo | WebSocket / cache frontend |

---

## Tests

```bash
cd whatsapp-bot && npm test
cd frontend && npm test
```

- `simulator-persistence.service.test.js` (helpers)
- `conversation-live.broadcaster.test.js`
- `applyConversationLiveEvent.test.ts` (actualizado)

---

## Riesgos pendientes

- `conversations:simulate-message` requiere password en env (no cookie jar completo).
- Producción: considerar ocultar canal simulator en UI si `DEV_TOOLS_ENABLED` no está activo (filtro producto, no persistencia).
- Tests de integración E2E con DB real no automatizados en CI.

---

## Estados

- `SIMULATOR_CONVERSATIONS_PERSISTED`
- `SIMULATOR_CONVERSATIONS_VISIBLE_IN_LIST`
- `SIMULATOR_CONVERSATIONS_REALTIME_READY`
