# TB-005 — decisiones de las correcciones

No se reimplementó la firma. El default compatible se mantiene y se cerraron los huecos que el review marcó.

## Configuración

`resolveTwilioSignatureMode()` sigue devolviendo `off` con `source: default` cuando `TWILIO_SIGNATURE_MODE` falta o está vacía. Desplegar el código sin la variable no corta el inbound.

Eso no es una activación. `assessTwilioSignatureReadiness()` marca `configurationState: insecure`, `activated: false`, `secure: false` y `ready: false`. `ready` es true solo con modo `log` y configuración completa. `enforceReady` y `productionUrlVerified` quedan false: este proceso no vio tráfico público.

El preflight imprime el modo, si hay auth token, la validez de `APP_BASE_URL`, la validez del prefijo, el estado, `logReady` y si enforce se puede considerar. No imprime el token ni la firma.

`validateConfig()` escribe ese JSON y corta el arranque cuando el modo es inválido, o cuando `log` o `enforce` no pueden verificar. No cambia el modo a `off`.

`.env.example` deja `TWILIO_SIGNATURE_MODE=log` comentado. Copiar el ejemplo no activa log.

## URL

`planTwilioPublicUrl()` no mira el request ni `X-Forwarded-*`.

- Origen: `protocol//host` de `APP_BASE_URL`, con puerto no estándar.
- Prefijo: el pathname de `APP_BASE_URL` o `TWILIO_PUBLIC_PATH_PREFIX`. Nunca los dos.
- Ruta y query: `req.originalUrl`, copiados sin recodificar.

Contrato operativo:

- Sin prefijo: base solo origen, prefijo vacío, Express recibe la ruta pública.
- Nginx elimina el prefijo: el prefijo está en un solo lugar y Express recibe la ruta interna.
- Nginx conserva el prefijo: base solo origen, prefijo vacío, `originalUrl` ya trae el prefijo.
- Prefijo en la base y en la variable: `public_prefix_ambiguous`. `log` y `enforce` no arrancan. El request, si llegara, responde 403.
- Un segmento parecido, `/web` contra `/webhooks/...`, no se trata como el mismo prefijo.

La causa del fallo anterior era concatenar base, prefijo y `originalUrl` con `startsWith`/`endsWith`. Esa heurística duplicaba `/tea` y podía confundir segmentos.

## Modo log

`log` sin token, sin URL válida o con prefijo ambiguo no arranca. El mensaje dice que respondería 403 y que no es una activación inocua.

Con log sano, una firma inválida o ausente se registra y se procesa. Falta de token, URL inválida o body que no se puede firmar siguen en fallo cerrado: 403 o 400, sin caer a `off`.

Pasaje sin cortar tráfico legítimo:

1. Dejar `off`.
2. Poner token y una URL con un solo prefijo.
3. Correr `node scripts/twilio-signature-preflight.js` hasta `logReady: true`.
4. Pasar a `log` y reiniciar.
5. Mirar `twilio_signature_valid` antes de pensar en `enforce`.

## Ensamblado HTTP

`createApp()` arma json, urlencoded con `rememberUrlencodedBody`, CORS, routers, health y `twilioWebhookBodyError`. No llama `validateConfig()`, no escucha y no arranca workers.

`app.js` usa esa factory y después valida, arranca workers, WebSocket y `listen`.

Las pruebas de app y la integración SQL montan `createApp()`. Comprueban orden, body crudo con claves repetidas, body malformado, status con https, puerto, prefijo y headers forwarded falsos, y que un 403 no escribe TwiML ni eventos.

## SQL

Cada test toma los ids de conversación que ya existían para ese teléfono y `externalUserId`. El `after` borra solo los ids nuevos, por id, y los eventos del `MessageSid` de ese test. Si el helper recibe un id del conjunto previo, lanza y no ejecuta el `DELETE`.

El `after` del archivo exige que la conversación centinela (`TOP 1` tomada al preparar) siga existiendo. La corrida dejó 0 filas de los teléfonos fixture y 0 eventos `SMT%`. No se creó otra base ni se aplicó una migración.

## Status

`resolveTwilioRequestUrl()` devuelve la misma URL que el inbound, o vacío si el plan no es válido. `verifyTwilioSignature()` exige token, firma, plan y parámetros. No usa `X-Forwarded-*`. El modo inbound no la relaja.

Instalaciones que firmaban el status solo con headers forwarded y sin `APP_BASE_URL` pasan a 403 hasta configurar la URL. Es el cierre del fallback permisivo.

## TB-006

No se editaron idempotencia, fencing, reclaim, `FAILED`, `DEAD_LETTER`, replay, reentrada, handoff ni takeover. La migración 009 sigue sin aplicarse. Las dos integraciones que la necesitan quedan skipped.

Una firma inválida en `enforce` responde 403 antes del controlador: no hay `provider_webhook_events` ni mensajes. El retry válido del mismo `MessageSid` sigue en un solo `PROCESSED`.
