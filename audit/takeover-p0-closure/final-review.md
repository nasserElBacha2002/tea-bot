# Revisión final

Estado: `READY_FOR_REVIEW`.

No es `READY_FOR_PRODUCTION_ACTIVATION`: el cambio no está commiteado, el VPS no se releyó en esta sesión y el flag productivo no se toca hasta una intervención aparte.

## Qué quedó cerrado en local

La toma de una conversación `bot` existe, es exclusiva cuando el flag está encendido, y las dos pruebas SQL que estaban en skip pasaron contra `tea-bot`. La 009 quedó aplicada y registrada. El inbound asignado no corre el menú. La reentrada de la suite pasó sin skips. El frontend distingue bot activo, atención humana y el cierre, y no declara éxito antes de la API.

## Hallazgos

### P0

Ninguno confirmado.

### P1

Ninguno confirmado en el diff.

### P2 — límite de diseño, no corregido

Después de autorizar y commitear el outbound, el proceso puede escribir TwiML o ya haber recibido el SID de Twilio. Esa ventana no se cierra sin mantener el lock durante la llamada externa. La toma no retira ese mensaje. El turno siguiente ya no ejecuta el motor.

No verificado contra Twilio real.

### P2 — no verificado

Dos backends separados. La prueba paralela usa dos transacciones del mismo proceso. El `UPDLOCK` es de SQL Server.

El VPS no se inspeccionó de nuevo. El plan de activación sigue apoyado en el inventario de `audit/tb-005-006-deploy`.

### P3

El mensaje de sistema de “devuelta al bot” se inserta después del commit de la transición. Un fallo ahí deja el estado correcto y omite ese texto.

`npm run lint` sigue en error por reglas de hooks y refresh que ya estaban fuera de este recorrido.

Nueve conversaciones locales `assigned` no tienen agente. Son datos previos. La toma las considera sin dueño. No se migraron.

Si en producción existe `INTERNAL_AGENT_ID`, admin y operador colapsan en un solo id. No está en el `.env` local. No se releyó el contenedor productivo.

## Correcciones de esta pasada

- 009 aplicada en `tea-bot` después de backup verificado.
- Aserción de TB-005 actualizada: 009 y 010 aplicadas.
- Comparación de agentes sin depender de las mayúsculas del `uniqueidentifier`.
- `paused` entra al modo humano del inbound y de la reentrada.
- Claim, envío, cierre y devolución exigen cuenta habilitada.
- La UI no ofrece devolver al bot cuando el estado ya es `bot`, y nombra la atención humana.
- El evento en vivo no le dice al dueño que perdió la conversación.

## Regresiones buscadas

Firma válida e inválida, idempotencia del inbound, reentrada, matching v62, estados y envío manual están en la suite de 428 con 0 skips. El build del frontend pasó. No se debilitó el guard `TB_SQL_TEST_CONFIRM`.

## Producción y flag

Sin cambios. `MANUAL_TAKEOVER_ENABLED` sigue apagado por default. `TWILIO_SIGNATURE_MODE` no se tocó.
