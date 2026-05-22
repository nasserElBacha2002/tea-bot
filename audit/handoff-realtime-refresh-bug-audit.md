# Auditoría: handoff → realtime `/conversations` → Tomar conversación

**Estado:** `HANDOFF_REALTIME_BUG_AUDITED`

## 1. Estado guardado al pedir humano

- FlowEngine termina en nodo `human_handoff` (`isEngineHumanHandoffResult`).
- `HumanHandoffService.requestHumanHandoff`:
  - Crea/reutiliza fila `human_handoffs` con `status: pending`.
  - `conversations.status` → `waiting_human`.
  - `assignedAgentId` → `null`.
  - `currentNodeKey` → `human_handoff` (u otro del motor).
  - Sesión activa → `paused`.

## 2. ¿Se actualiza la conversación en DB?

Sí, vía `conversationRepo.updateConversation` en `pauseConversationForHuman`.

## 3. ¿Se emite `conversation.updated`?

Sí. Tras el fix, una sola emisión desde `requestHumanHandoff` con extras:

- `data.conversation` (`mapConversationPublic`)
- `data.humanHandoff` (`mapHumanHandoffPublic`)

Antes también se emitía desde `pauseConversationForHuman` **sin** `humanHandoff` (doble evento parcial).

## 4–5. ¿`conversation.message.created`?

| Origen | Usuario | Bot derivación |
|--------|---------|----------------|
| Twilio webhook | `handleInbound` → `persistInboundMessage` | `handleHumanHandoff` → `persistOutboundBotMessage` (+ `handoff` en extras) |
| Simulador | `persistUserInputBeforeEngine` | `persistEngineResponseAfter` → handoff + mensaje bot con `humanHandoff` |

Ambos incluyen `conversation`, `message`, `lastMessage` en el payload WS.

## 6. Payload al frontend

```json
{
  "type": "conversation.updated",
  "conversationId": "…",
  "occurredAt": "…",
  "data": {
    "conversation": { "status": "waiting_human", "assignedAgentId": null, "currentNodeKey": "human_handoff", … },
    "humanHandoff": { "status": "pending", "reason": "…", "assignedAgentId": null, … }
  }
}
```

`conversation.message.created` añade `message` y `lastMessage`.

## 7–8. ¿Frontend actualizaba lista/detalle?

Parcialmente. `applyConversationLiveEvent` parcheaba si `data.conversation` existía, pero:

- En `conversation.updated` parcial **reemplazaba** `lastMessage` y `humanHandoff` por `null` al no venir en el evento.
- No trataba explícitamente `conversation.updated` sin summary (no invalidaba).
- Detalle no se invalidaba si aún no estaba en cache al llegar handoff con conversación seleccionada.
- Handoff no marcaba unread/destacado cuando la conversación no estaba seleccionada.

## 9. Causa del refresh manual

El backend emitía `conversation.updated`, pero el frontend **degradaba** el ítem en cache (perdía `humanHandoff`/`lastMessage`) y el detalle podía quedar con `status: 'bot'` si el último evento aplicado era un `message.created` previo o un `updated` parcial. La UI de “Tomar conversación” depende de `detail.conversation.status === 'waiting_human'` y `assignedAgentId == null` — sin merge correcto, el botón no aparecía hasta refetch REST.

## Archivos clave

| Área | Archivo |
|------|---------|
| Handoff DB + notify | `whatsapp-bot/src/services/human-handoff.service.js` |
| Twilio persist | `whatsapp-bot/src/services/message-persistence.service.js` |
| Simulador | `whatsapp-bot/src/services/simulator-persistence.service.js` |
| WS notify | `whatsapp-bot/src/realtime/conversation-live.notify.js` |
| Live apply | `frontend/src/features/conversations/utils/applyConversationLiveEvent.ts` |
| WS hook | `frontend/src/features/conversations/hooks/useConversationsLiveUpdates.ts` |
| Tomar UI | `frontend/src/features/conversations/components/ConversationDetail.tsx`, `ConversationComposer.tsx` |
