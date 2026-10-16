# DoD — Layout chat, inputs de usuario y sin leer

**Fecha:** 2026-05-22  
**Estados:** `CONVERSATION_COMPOSER_FIXED`, `CONVERSATION_MESSAGES_SCROLLABLE`, `USER_BOT_INPUTS_VISIBLE_IN_CHAT`, `CONVERSATIONS_UNREAD_VISIBILITY_IMPROVED`

---

## Problemas detectados

1. **Composer no fijo:** El panel de detalle no encadenaba `min-height: 0` / `overflow: hidden`; header, timeline y composer scrolleaban juntos.
2. **Inputs de usuario invisibles en simulador:** `sendMessage` ejecutaba FlowEngine **antes** de persistir el inbound; en modo bot no se emitía `conversation.message.created` para el mensaje del usuario.
3. **Sin leer poco visible:** Solo un punto en la lista; cualquier mensaje WS marcaba unread; sin contadores, badges ni aviso de filtros.

---

## Causa raíz — composer

- `ConversationDetail` no fijaba altura al panel (`height: 100%`, `overflow: hidden`).
- El timeline necesitaba `flex: 1`, `minHeight: 0`, `overflowY: auto` en un contenedor dedicado.

## Solución layout

- `ConversationDetail`: columna flex con header `flexShrink: 0`, timeline `flex: 1`, composer `flexShrink: 0` con borde superior y fondo sólido.
- `ConversationMessageTimeline`: scroll solo en el área de mensajes; botón “Nuevos mensajes” si llegan eventos lejos del final.
- `ConversationsPage`: panel derecho con `overflow: hidden` y `minHeight: 0`.

---

## Causa raíz — mensajes de usuario

- `simulator.service.js` llamaba `flowEngine` antes de persistir.
- `persistSimulatorTurn` guardaba inbound en bot path pero **no** notificaba WebSocket (solo outbound bot).

## Cambios persistencia / WS

- Nuevo flujo: `persistUserInputBeforeEngine` → `notifyConversationMessageCreated` → `flowEngine` → `persistEngineResponseAfter` (sin duplicar inbound).
- `emitUserInbound` centraliza touch + notify.
- Twilio ya persistía antes del motor vía `message-persistence.service.js` (sin cambio).

## Cambios frontend render

- `conversationMessageDisplay.ts`: normaliza rol por `senderType` / `direction`; no filtra por tipo.
- Timeline renderiza todo mensaje con `body` (1, humano, menú, etc.).

## Nueva / sin leer

- **Detección:** `unreadIds` + `unreadCounts` en vivo; `isInboundUserLastMessage` en REST; badge “Nuevo” vía `conversation.created`.
- **lastReadAt:** localStorage por `agentId` (`useConversationReadState`); se limpia al abrir conversación.
- **WS:** Solo `inbound` + `senderType: user` incrementa unread si la conversación no está seleccionada.
- **Filtros:** Contador `hiddenByFilterCount` + alerta “Limpiar filtros”.
- **Global:** Chips “N sin leer” / “N esperando atención” bajo el título.

---

## Tests ejecutados

```bash
cd whatsapp-bot && npm test
cd frontend && npm test
```

Cobertura añadida:

- Backend: `emitUserInbound` notifica inbound.
- Frontend: `conversationMessageDisplay`, `conversationUnread`, `applyConversationLiveEvent` (bot no unread), `ConversationListItem`, timeline inputs cortos.

---

## Validación manual

| Caso | Pasos | Esperado |
|------|--------|----------|
| Layout | Abrir conversación larga en `/conversations` | Header arriba, historial con scroll, composer visible abajo |
| Inputs | Simulador: enviar `1`, `humano` | Burbuja usuario + respuesta bot; persisten tras Actualizar |
| Realtime | `/conversations` abierto + simulador envía `2` | Aparece sin duplicar |

---

## Riesgos pendientes

- `lastReadAt` solo en localStorage (no sobrevive entre dispositivos hasta endpoint DB).
- Contador “fuera de filtros” es heurístico (incrementa si el id no está en la lista visible).
- Auto-scroll “cerca del final” usa umbral 80px (ajustable por config futura).
