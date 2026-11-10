# TB-006 — Cierre

Estado: `READY_FOR_REVIEW`.

Esta sesión no hizo commit, push ni deploy. El HEAD actual es `ac7e699`, que ya contenía la implementación anterior de TB-006. El diff sin commitear es el cierre de arriba.

## Correcciones

**Clave outbound.** Un `MessageSid` válido de hasta 119 caracteres sigue usando el sufijo histórico `:outbound`. Uno más largo no queda sin clave: usa `out_` más el SHA-256, cabe en `NVARCHAR(128)` y es estable entre reintentos. No pisa el id del inbound. No había filas históricas con esa forma larga, porque antes la función devolvía null.

**Auditoría.** Cuando el registro lleva `providerMessageId`, el `SELECT` y el `INSERT` ocurren en la misma transacción con `UPDLOCK, HOLDLOCK`. Una segunda escritura de la misma entidad, acción y SID no inserta otra fila. Una acción distinta sí se inserta. Los registros sin ese id siguen siendo append-only y no toman ese lock.

**DEAD_LETTER.** `requeue` solo cambia la fila a `FAILED` y libera un attempt. El resultado dice `stateChangedToFailed`, `executed: false`, `recovered: false` y `reprocessed: false`. El script sale 2 después de ese cambio y dice que el mensaje no se ejecutó. No borra filas.

**Preflight.** `--execute` comprueba la instancia, la base, la tabla, las columnas de 007, el índice único, 007 registrada, 010 registrada, `response_body` con largo `-1`, la ausencia de un check que restrinja los estados y una escritura de TwiML que se revierte. El probe no quedó en la tabla. `--apply-010` solo aplica ese archivo y se niega si el registro y la columna no coinciden.

**Fence.** El cierre de sesiones por cambio de flujo ahora entra por `withFencedWrite`. Las demás escrituras del turno ya tomaban el fence en la misma transacción que el efecto: mensaje, update de conversación, sync de sesión, reentrada, handoff y reapertura. La auditoría queda después del commit de la reapertura; si el lease se perdió, la reapertura no commitea y no llega a auditar.

**tea-bot.** `TB_SQL_TEST_CONFIRM=tea-bot` autoriza el nombre exacto `tea-bot` solo en localhost, `127.0.0.1` o `sqlserver`. Sin esa variable no hay escrituras. Un servidor remoto se rechaza. `tea_bot_test_<sufijo>` con su propia confirmación sigue siendo válido. El `.env` no se modificó.

## Lo que la suite demostró

361 pass, 0 fail, 2 skip, exit 0, 164810 ms. Las dos omisiones piden la migración 009 y no se contaron como aprobadas. El takeover sigue apagado y 009 no se aplicó.

Las pruebas concurrentes, el reclaim, la pérdida del worker anterior, el TwiML exacto, la unicidad de mensaje y handoff, la reentrada y el monitoreo apagado corrieron contra `tea-bot`.

## Riesgo que sigue

La entrega a WhatsApp no es exactly-once. Si Twilio ya aceptó el body y reintenta, el texto puede salir otra vez. Los efectos internos de ese SID no se vuelven a aplicar.

Un turno del motor más largo que la ventana de reclaim, sin una escritura en el medio, puede ser tomado por otro worker. Los dos pueden ejecutar el motor. Solo el dueño del fence commitea.

No hay un índice único de auditoría. La garantía es el lock de `record()`. Un insert que no pase por ese método puede repetir la fila.

## Merge

Se puede revisar este diff. No está commiteado. 009 no forma parte del merge de TB-006 mientras el takeover siga apagado.

## Deploy

No desplegar este working tree. En el destino hace falta el backup, `tb006-preflight.js --execute` con `ready: true`, y el backend de este cierre. 010 ya está en la `tea-bot` local; no está aplicada en producción por esta sesión. El replay de TwiML depende de esa columna.
