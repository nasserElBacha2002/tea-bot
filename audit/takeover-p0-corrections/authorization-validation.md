# Autorización de toma, respuesta y cierre

`admin` y `conversations_only` pueden tomar una conversación en `bot`, aunque el usuario de WhatsApp no haya pedido atención humana. La diferencia entre los roles queda en la reasignación, que es solo de administrador.

## Hallazgo

El cierre ya recibía al actor y lo evaluaba bajo el lock. Un administrador que no era dueño podía igual cerrar la atención si el body traía `force: true`. Esa vía salteaba la propiedad sin una reasignación.

## Regla que quedó

Dentro de la transacción que bloquea la fila:

- El dueño responde, cierra y devuelve al bot.
- Cualquier otra cuenta, incluido un administrador, recibe 409 `CONVERSATION_OWNED`. `force` no cambia el resultado.
- Un administrador interviene con `POST /transfer`: motivo obligatorio, destino habilitado, fila bloqueada y fila en `audit_logs` con acción `manual_reassign`.
- Un operador que intenta reasignar recibe 403.
- Con la toma apagada, cualquier operador habilitado puede cerrar. El inbox compartido se mantiene.

El botón no autoriza. `canReturnToBot` sale del detalle y el cierre vuelve a mirar la fila.

## HTTP real, dos cuentas, tea-bot

`conversation-return-authorization.integration.test.js` firmó dos cookies `tea_session` contra cuentas distintas. Los ids no coinciden. Si `INTERNAL_AGENT_ID` los iguala, la prueba falla.

Resultado: pass, no skipped.

- Las dos cuentas vieron `canTakeover` en una conversación `bot` y las dos tomaron una.
- El dueño respondió 201. El otro, y el administrador, recibieron 409 al responder, cerrar o devolver.
- `force: true` del administrador también recibió 409. La fila siguió del dueño.
- El operador no pudo transferir: 403.
- El administrador reasignó con motivo. Quedó una fila `manual_reassign`, el nuevo dueño respondió y el anterior recibió 409.
- El dueño original devolvió al bot: estado `bot`, sin agente, `reentry_json.status = pending`.
- Con el flag apagado, el otro operador cerró.
- Devolución y reasignación en paralelo: una 200, una 409, y una sola fila coherente.
