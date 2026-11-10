# TB-006 — Correcciones del code review

Estado: `IMPLEMENTED_PENDING_VALIDATION`.

No hay commit. La migración 010 no se aplicó. Las pruebas que escriben SQL no se ejecutaron.

## 1. Defectos corregidos

**Detección de `response_body`.** `COL_LENGTH` y `sys.columns.max_length` devuelven `-1` para `NVARCHAR(MAX)`. La comparación `> 0` trataba la columna como ausente, así que el TwiML nunca se guardaba aunque 010 estuviera aplicada. Ahora la columna existe cuando `max_length` no es null, incluido `-1`. Un resultado negativo no se cachea: aplicar 010 sin reiniciar el proceso se ve en el próximo cierre. El test usa un query falso, no el texto de la migración: con longitud null el `UPDATE` no escribe `response_body`; después de pasar a `-1`, el cierre guarda el TwiML exacto y un segundo cierre no lo reemplaza.

**Efectos del turno.** El índice único `(provider, provider_message_id)` sigue siendo la clave. El inbound usa el `MessageSid`. El outbound automático usa `MessageSid:outbound`, así que un reintento no inserta otro mensaje. Si ese outbound ya está commiteado, el pipeline lo devuelve y no vuelve a entrar al motor ni a la reentrada. La violación única también se resuelve leyendo la fila existente.

La transición de reentrada y el `turnEffect` del mismo `MessageSid` se escriben en la misma transacción. Un crash deja las dos cosas o ninguna. El reintento ve el efecto y no vuelve a armar el prompt ni a contar otro intento inválido. El handoff activo sigue saliendo de `ensurePendingHandoffAtomic`, ahora después de tomar el fence, y la confirmación usa la misma clave de outbound. El sync de sesión del turno del bot ocurre en la transacción que inserta el outbound cuando el turn guard persiste. La reapertura deja de estar `closed`; un segundo inbound no vuelve a registrar esa auditoría, y el registro lleva `providerMessageId` para no repetirlo si el insert ya existe.

**Lease con el worker anterior vivo.** `attempts` es el fence. Cada escritura de efecto hace, en la misma transacción corta, `UPDATE provider_webhook_events SET updated_at = now WHERE id AND status = PROCESSING AND attempts = generación`. Si no coincide, lanza `INBOUND_LEASE_LOST`, la transacción no commitea y el controlador responde 503. El worker viejo no puede cerrar la fila ni dejar su TwiML. La sesión en memoria de ese proceso se resetea. No queda una transacción abierta durante el FlowEngine ni durante el HTTP a Twilio. El `updated_at` de cada escritura alarga el lease; no hay un timer aparte.

**Estados terminales.** `TAKEOVER_SCHEMA_REQUIRED` y cualquier `reply_indeterminate` responden 503 y quedan `FAILED`, no `PROCESSED`. Un esquema ausente no se presenta como mensaje procesado. Con el takeover apagado esa rama no se toma. `DEAD_LETTER` emite `inbound_dead_letter_alert` con id, SID, attempts y el error ya truncado. `scripts/webhook-dead-letter.js` lista esas filas y `requeue` las pasa a `FAILED` restando un attempt, sin borrarlas y sin tocar una fila que no esté en `DEAD_LETTER`. El reintento posterior reutiliza los efectos ya guardados por `MessageSid`.

**Base de pruebas.** No alcanza con que el nombre contenga `test`. Hacen falta servidor local, nombre `tea_bot_test_<sufijo>` y `TB_SQL_TEST_CONFIRM=tea_bot_test`. `tea-bot`, un nombre con `prod` y un servidor remoto quedan afuera. Los scripts sin `--execute` no abren conexión. `--execute` contra el entorno actual salió 2 y no conectó.

## 2. Riesgos descartados con evidencia

- El archivo local no volvió a ser autoridad del inbound Twilio. El controlador sigue sin importar `webhookDedupe` ni `monitoringEnabled`. La suite lo afirma.
- Un duplicado en `PROCESSING` sigue respondiendo 503. Un `PROCESSED` no vuelve a ejecutar el turno.
- El worker que perdió `attempts` no pisa el TwiML del dueño nuevo. Está cubierto por el fake de lease y por el predicado SQL `status = PROCESSING AND attempts = $2`. La versión con dos conexiones SQL no corrió.
- Reentrada, handoff, takeover apagado y el mensaje interno de la toma siguen verdes en la suite unitaria. El flag de takeover no se prendió.
- `NVARCHAR(MAX)` ya no se interpreta como columna ausente. Lo demuestra el query falso con `column_length = -1`, no una lectura del archivo 010.

## 3. Riesgos residuales

- La entrega a WhatsApp no es exactly-once. Si Twilio aceptó el primer body y aun así reintenta, el replay puede enviar el mismo texto otra vez. Los efectos internos de ese SID no se vuelven a aplicar.
- Si el motor tarda más que la ventana de reclaim y no hay una escritura en el medio, otro worker puede adquirir el SID. Los dos pueden ejecutar el motor. Solo el dueño del fence commitea. El otro revierte sus escrituras y responde 503.
- No hay un índice único de una sola sesión activa. El fence serializa las escrituras de un mismo SID. Dos mensajes distintos del mismo usuario siguen pudiendo competir por la sesión como antes.
- Sin la columna `response_body`, un retry de un evento `PROCESSED` responde TwiML vacío. La exclusión del turno se mantiene.
- El webhook de Meta sigue usando el dedupe de archivo. No es el camino de Twilio.
- La auditoría de reapertura es append-only. La transición deja la conversación fuera de `closed` y el `providerMessageId` evita un segundo insert del mismo SID. No es una garantía de infraestructura más allá de eso.

## 4. Pruebas unitarias aprobadas

Suite final: 325 pass, 0 fail, exit 0. Incluye webhook, reentrada, handoff, takeover con el flag apagado, pipeline, turn guard, la sonda de `NVARCHAR(MAX)`, el fence, el replay de un outbound ya commiteado y el `FAILED` de `TAKEOVER_SCHEMA_REQUIRED`.

## 5. Integraciones SQL aprobadas

Ninguna. No se ejecutó ninguna prueba que escriba SQL.

## 6. Integraciones omitidas

35 pruebas, todas con `SQL TEST aislado no configurado: DB_NAME debe ser tea_bot_test_<sufijo>`. Salen antes de `ping`. Entre ellas están las dos conexiones concurrentes, el reclaim en SQL, la pérdida de ownership en SQL, la unicidad de mensaje y handoff en SQL, la aplicación de 010 y el replay leído desde la columna, y el segundo begin con monitoreo apagado contra SQL. El caso de SQL caído durante la adquisición está cubierto por el unitario que no abre conexión: HTTP 503 y el turno no corre.

## 7. Migraciones pendientes

010, forward-only, solo agrega `response_body NVARCHAR(MAX) NULL`. No se aplicó. 007 no se modificó. 009 no hace falta mientras el takeover siga apagado.

## 8. Condiciones para merge

No mergear con este estado. Hace falta una base `tea_bot_test_<sufijo>` en localhost, `TB_SQL_TEST_CONFIRM=tea_bot_test`, 010 aplicada ahí, y la suite con las 35 pruebas SQL en pass y cero skip de ese grupo. El resultado de esta corrida no sustituye eso.

## 9. Condiciones para despliegue

1. Base compatible. No editar 007.
2. Migraciones verificadas, 010 incluida antes de depender del replay. Sin 010 el retry de un `PROCESSED` responde vacío.
3. Backend de esta entrega.
4. La suite SQL del punto anterior en verde.
5. `node scripts/tb006-preflight.js --execute` con `ready: true` contra la base de destino ya confirmada, no contra `tea-bot` por accidente.
6. Activar el proceso y mirar `inbound_acquired`, `inbound_failed` e `inbound_dead_letter_alert`. Un `DEAD_LETTER` se reintenta con el script, no borrando la fila.

No desplegar este working tree. No cambiar flags. No aplicar 010 en `tea-bot` ni en producción desde aquí.
