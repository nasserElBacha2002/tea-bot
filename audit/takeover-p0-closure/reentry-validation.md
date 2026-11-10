# Validación de reentrada

## Implementado

`returnConversationToBot` resuelve handoffs activos, termina sesiones abiertas, limpia `assigned_agent_id`, deja `status=bot` e incrementa `status_version`. Con `REENTRY_POLICY=prompt`, si se vuelve de `waiting_human`, `assigned`, `paused`, de un nodo terminal de handoff o si se resolvió un handoff, arma `reentry_json`. Si ya había `pending` o `awaiting_choice`, lo conserva.

El sync posterior del FlowEngine solo escribe cursor cuando `reentry_json` es nulo y el estado sigue siendo `bot`.

## Verificado con SQL real

En la suite de 428, sin skips, pasaron entre otras:

- cierre humano y texto libre quedan en reentrada, no en welcome
- continuar restaura el nodo publicado de la misma versión
- nueva consulta presenta el entry y no matchea el comando
- handoff activo no responde con el prompt
- dos webhooks distintos dejan un solo `awaiting_choice`
- el mismo `MessageSid` no consume la reentrada dos veces
- el sync del motor no pisa el cursor con reentrada pendiente
- la toma manual actual no absorbe una reentrada en bot
- versión histórica ausente reinicia
- el contador de intentos sobrevive a una instancia nueva
- doble cierre es idempotente
- rollback mantiene el handoff activo si falla antes del commit
- una conversación asignada no ejecuta el menú
- la reentrada pendiente no consume Dirección de estudios ni 3
- producción v62 persiste Dirección de estudios y el fallback

## Verificado con tests de dobles

`conversation-reentry.service.test.js` y `conversation-bot-lifecycle.service.test.js` cubren conversación sin email, handoff resuelto y el reset de runtime.

## Pendiente

Un WhatsApp real después de devolver una conversación tomada con el flag encendido. La política local de tests usa el default `prompt` salvo el caso que fija `legacy`.

## Cambio de esta entrega

`paused` entra en “vuelve de atención humana”, igual que entra en el salto del motor. Antes solo lo hacía si había handoff resuelto o nodo terminal.
