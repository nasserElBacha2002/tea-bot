# TB-006 — Decisiones de implementación

Estado: `IMPLEMENTED_PENDING_VALIDATION`.

La idempotencia del inbound de Twilio ya no depende de `MONITORING_ENABLED` ni del archivo local. La autoridad es `dbo.provider_webhook_events`. Falta comprobar esa autoridad contra SQL Server: no hay una base cuyo nombre contenga `test`, y la migración 010 no se aplicó.

## Flujo anterior

1. Twilio entrega un webhook con `MessageSid`.
2. `openMonitoringGate` llama a `beginInboundEvent` solo si `MONITORING_ENABLED` está activo.
3. Si el flag está apagado, o si el alta del evento lanza, el controlador sigue con `tracked: false`.
4. En ese camino `webhookDedupe.markProcessed` escribe el SID en `data/webhook-processed-ids.json` antes de `processCanonicalTwilioInbound`.
5. Un error posterior deja el SID marcado. El reintento de Twilio se descarta.
6. El archivo no excluye a otra instancia del proceso.
7. Un error de procesamiento respondía HTTP 200 con el TwiML «No pudimos procesar tu mensaje…». Twilio no reintenta un 2xx.

Con el flag activo y SQL disponible, el cierre ocurría después del turno. El fallo está en el camino alternativo, que es el camino real mientras el monitoreo está apagado.

## Flujo nuevo

1. Adaptar el body y validar `MessageSid` con `/^[A-Za-z0-9_-]{1,128}$/`.
2. Si el SID falta, está vacío o no cumple el patrón, responder 400 con TwiML vacío. No se inserta una fila y no se inventa un identificador.
3. Adquirir la fila en SQL antes de cualquier efecto del turno.
4. Ejecutar el pipeline solo si la adquisición autoriza `process` y hay texto.
5. Armar el TwiML con las mismas reglas de handoff, reentrada, takeover y respuesta vacía.
6. Cerrar la fila con el lease de `attempts` y, si existe la columna, guardar ese TwiML.
7. Responder a Twilio.

`receiveTwilioMessage` solo traduce el resultado de `settleTwilioInbound` a HTTP. El controlador ya no importa `webhookDedupe` ni `monitoringEnabled`.

## Dedupe local

`webhook-dedupe.service.js` sigue existiendo porque el webhook de Meta lo usa antes del motor. Quitarlo rompería ese proveedor. El inbound de Twilio ya no lo consulta y no lo escribe.

No hay dos autoridades para un `MessageSid` de Twilio. El archivo no es un fallback cuando SQL falla.

## Estados

Los nombres históricos se mantienen. El ticket habla de `COMPLETED`; en esta base el estado terminal de un turno logrado es `PROCESSED`. Renombrarlo rompería filas y consultas ya desplegadas con la migración 007.

| Situación | Estado | HTTP | TwiML | Turno |
| --- | --- | --- | --- | --- |
| SID no confiable | sin fila | 400 | vacío | no |
| SQL no puede adquirir | sin decisión | 503 | vacío | no |
| Fila nueva | `PROCESSING`, attempts 1 | sigue el turno | el del turno | sí |
| `PROCESSING` vigente | sin cambio | 503 | vacío | no |
| `PROCESSING` con `updated_at` vencido y attempts bajo el máximo | reclaim, attempts + 1 | sigue el turno | el del turno | el nuevo dueño |
| `FAILED` con attempts bajo el máximo | vuelve a `PROCESSING` | sigue el turno | el del turno | sí |
| `PROCESSED` | sin cambio | 200 | `response_body`, o vacío si no está la columna | no |
| `DEAD_LETTER` | sin cambio | 200 | vacío | no |
| El turno lanza | `FAILED`, o `DEAD_LETTER` al llegar al máximo | 503 | vacío | no se marca `PROCESSED` |
| `TAKEOVER_SCHEMA_REQUIRED` | `PROCESSED` con TwiML vacío | 200 | vacío | no se reintenta |

Un duplicado todavía en `PROCESSING` responde 503. Un 200 le diría a Twilio que el mensaje fue aceptado y eliminaría el reintento mientras el dueño todavía puede fallar.

`DEAD_LETTER` responde 200 en el intento siguiente para no dejar un reintento infinito. El máximo sigue siendo `WEBHOOK_MAX_PROCESSING_ATTEMPTS`, con default 3. El intento que cruza el máximo se registra como `DEAD_LETTER` y responde 503; el próximo webhook del mismo SID ya no ejecuta el turno.

`TAKEOVER_SCHEMA_REQUIRED` queda terminal. Reintentar no crea la columna `status_version`. Marcarlo `FAILED` solo consumiría intentos. El flag de takeover sigue apagado y esta entrega no exige la migración 009.

El 200 de disculpa se eliminó. Un 200 en un fallo detenía el único mecanismo de recuperación que Twilio ofrece. El usuario deja de ver ese texto cuando el turno lanza; Twilio reintenta.

## Recuperación y reclaim

No se agregó una columna de owner. `attempts` es la generación del lease.

`markWebhookProcessed` y `markWebhookFailed` actualizan solo cuando `id` coincide, `status = PROCESSING` y `attempts` es el de la adquisición. El reclaim incrementa `attempts`. El worker anterior deja de coincidir, recibe `owned: false` y no pisa el estado ni el TwiML del dueño nuevo. Si pierde el lease después de haber armado una respuesta, el controlador responde 503 y no envía ese TwiML.

El reloj de reclaim es `updated_at`, con ventana `WEBHOOK_PROCESSING_STALE_SECONDS` (default 120). El `UPDATE ... OUTPUT` condicional es el que gana el reclaim. Cero filas significa que este caller no es el dueño.

Un proceso que muere en `PROCESSING` no queda bloqueado para siempre: vencida la ventana, otro intento lo reclama hasta el máximo. Después pasa a `DEAD_LETTER`.

## TwiML y HTTP

`PROCESSED` significa que los efectos internos de ese intento quedaron comprometidos y que el TwiML guardado puede repetirse. No significa que Twilio haya leído el body ni que WhatsApp haya entregado el mensaje.

El cierre se escribe antes del `res.send`. Si el proceso cae entre el commit de `PROCESSED` y la aceptación HTTP, el reintento no vuelve a ejecutar el motor. Reproduce el TwiML guardado en `response_body`.

Eso no es exactly-once hacia WhatsApp. Si Twilio aceptó el primer body y aun así reintenta, el replay puede entregar el mismo mensaje de WhatsApp otra vez. Se eligió esa repetición antes que un 200 vacío, que haría desaparecer el menú cuando la respuesta HTTP sí se perdió.

Sin la migración 010 la columna no existe. El cierre igual pasa a `PROCESSED` y el retry responde TwiML vacío. La idempotencia de los efectos se sostiene; la reproducción del texto no. `hasResponseBodyColumn` cachea solo el positivo, así que aplicar 010 sin reiniciar el proceso alcanza para empezar a guardarlo.

El payload persistido en `payload_json` guarda `MessageSid` y `NumMedia`. No guarda `From` ni `Body`.

## Varios workers

La exclusión de la adquisición es la restricción única de 007 sobre `(provider, event_type, provider_message_id)` más el `UPDATE` condicional. Dos conexiones no pueden dejar las dos la fila en una generación que ambas crean propia.

Eso no envuelve los efectos del turno en la misma transacción que la fila del evento. Quedan dos ventanas donde los efectos internos pueden duplicarse:

- El turno ya commiteó mensajes o un handoff, y el proceso muere antes de `PROCESSED`. El reclaim vuelve a ejecutar el turno.
- El turno tarda más que la ventana de reclaim. El segundo worker puede ejecutar efectos mientras el primero sigue adentro. El primero ya no puede marcar `PROCESSED`.

No se agregó heartbeat ni una cola. Alargar el lease no cierra la ventana de crash, y un heartbeat sería otro mecanismo. Esas dos ventanas quedan como riesgo residual.

## Migraciones 007 a 010

- 007 no se modifica. Ya está aplicada y contiene la tabla, `updated_at`, `attempts` y el índice único filtrado.
- 008 y 009 no se tocan. La reentrada y el takeover no se reimplementan. 009 no hace falta para ejecutar TB-006 con el takeover apagado.
- 010 es forward-only y solo agrega `response_body NVARCHAR(MAX) NULL` si no existe. No se aplicó en `tea-bot` ni en otra base.

## Rollback

Revertir el código de esta entrega. No dropear `response_body` si alguien llegara a aplicar 010: el código anterior ignora la columna. No editar 007. Las filas `PROCESSED`, `FAILED` y `DEAD_LETTER` siguen siendo legibles por el código anterior. El archivo de dedupe de Meta no cambia.

## Observabilidad

Cada decisión emite una línea JSON con `event`, `provider`, `messageId`, `flowId`, `reason`, `attempts` y `httpStatus`:

- `inbound_acquired`
- `inbound_duplicate_completed`
- `inbound_already_processing`
- `inbound_failed`
- `inbound_reclaimed`
- `inbound_completed`
- `inbound_acquire_error`

No incluyen teléfono, body, token ni payload. El log de performance sigue usando `maskId` para el usuario. Se eliminaron los logs `Twilio From:` y `Normalized phone:` de este controlador. No hay dashboard nuevo.

## Tests bloqueados

T10 y el reclaim real están escritos en `webhook-acquire.integration.test.js` y salen antes de abrir una conexión. La condición es servidor local (`localhost`, `127.0.0.1` o `sqlserver`) y `DB_NAME` conteniendo `test`. `tea-bot` no califica.

La misma barrera cubre ahora reentrada, ciclo de vida, retención y takeover. Esas suites antes escribían en la base de desarrollo. En esta corrida no lo hicieron. Sus 31 skips no son aprobación.

La prueba de integración «el mismo MessageSid no consume la reentrada dos veces» sigue armada sobre el dedupe de archivo y quedó skipped. La prueba que cubre el camino nuevo es la unitaria de reentrada, que entra por `settleTwilioInbound`.

## Riesgos residuales

- La entrega a WhatsApp no es exactly-once. El replay puede repetir un mensaje que Twilio ya aceptó.
- Un crash entre el commit de los efectos y `PROCESSED` puede repetir mensajes internos o un handoff cuando el evento se reclama.
- Un turno más largo que la ventana de reclaim puede ejecutar efectos en dos workers. El lease solo impide que el worker viejo cierre la fila.
- Hasta aplicar 010, un retry de un evento `PROCESSED` responde TwiML vacío.
- El webhook de Meta sigue usando el archivo local como autoridad propia.
- Un inbound sin texto, incluido un multimedia con `Body` vacío, no entra al motor. Eso ya ocurría y se conserva.
- Después de `DEAD_LETTER`, el usuario no recibe el texto de disculpa. Recibe un 200 vacío en el intento siguiente.
- T10, el reclaim sobre SQL Server y el replay con la columna real no están ejecutados.
