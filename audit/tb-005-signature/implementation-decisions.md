# TB-005 — Decisiones de implementación

Estado: `READY_FOR_REVIEW`. `enforce` no está activado.

HEAD de partida: `ac7e69960f133cb32add5a140972329074cbf9fa`. Los cambios sin commitear de TB-006 se dejaron como estaban. Esta tarea no los reescribió.

## 1. Flujo anterior y nuevo

Antes, `POST /webhooks/twilio/:flowId` parseaba el formulario y entraba a `receiveTwilioMessage`. Esa función adquiere el `MessageSid` en SQL, persiste la conversación y ejecuta el motor. No miraba `X-Twilio-Signature`.

Ahora el mismo parseo ocurre primero, sin reescribir los parámetros. Después corre `verifyTwilioInboundSignature`. Solo si la decisión es aceptar se llama a `receiveTwilioMessage`. Un rechazo responde 403 o 400 y no llama al controlador.

El orden queda:

1. `express.urlencoded` guarda el body crudo y arma `req.body`.
2. Verificación de firma del inbound.
3. Recién ahí, adquisición SQL, conversación, reentrada, FlowEngine, handoff y WebSocket.

`POST /webhooks/twilio/:flowId/status` no entró en ese modo. Sigue en `verifyTwilioSignature`, que responde 403 si falta el token, falta la firma o la firma no cierra.

## 2. Rutas protegidas

| Ruta | Protección |
|---|---|
| `POST /webhooks/twilio/:flowId` | `TWILIO_SIGNATURE_MODE` |
| `POST /webhooks/twilio/:flowId/status` | Firma obligatoria, independiente del modo |

No hay otra ruta inbound de Twilio en el backend. `POST /webhook` de Meta queda fuera de TB-005.

## 3. Construcción de URL

La firma se calcula con `twilio.validateRequest`. No hay un HMAC propio.

La URL del inbound es:

`APP_BASE_URL` sin barra final + prefijo opcional + `req.originalUrl`.

`req.originalUrl` aporta la ruta que ve Express y el query string tal como llegó. No se vuelve a codificar.

`TWILIO_PUBLIC_PATH_PREFIX` cubre el caso en que Nginx publica un prefijo y el backend recibe la ruta sin ese prefijo. Si `APP_BASE_URL` ya trae el prefijo, no se duplica.

Ejemplo: Twilio firma `https://bot.example/tea/webhooks/twilio/main-menu` y Express recibe `/webhooks/twilio/main-menu`. Vale cualquiera de estas dos configuraciones:

- `APP_BASE_URL=https://bot.example/tea`
- `APP_BASE_URL=https://bot.example` y `TWILIO_PUBLIC_PATH_PREFIX=/tea`

`APP_BASE_URL` tiene que ser absoluta, `http` o `https`, sin usuario, contraseña, query ni fragmento. Si no lo es, no se considera una URL confiable.

El inbound no lee `X-Forwarded-Proto`, `X-Forwarded-Host` ni `Host` para armar esa URL. Tampoco se activó `trust proxy`. Un cliente no puede elegir la URL que se valida.

Si no hay URL confiable:

- `log` registra `twilio_signature_configuration_error` con razón `public_url_unconfigured` y procesa. No marca la firma como válida.
- `enforce` responde 403 y no procesa.
- El proceso no arranca si el modo ya es `enforce` y la URL no sirve.

El callback de estado conserva su resolución anterior: usa `APP_BASE_URL` cuando existe y, si no existe, el primer `X-Forwarded-*`. No se le aplicó el modo `log`. Con `APP_BASE_URL` configurada, el status también queda atado a esa URL.

## 4. Modos

| Modo | Firma válida | Firma inválida o ausente | Token o modo inutilizable |
|---|---|---|---|
| variable ausente | Igual que `off` | Igual que `off` | Igual que `off` |
| `off` | Procesa y registra `twilio_signature_mode_off` | Procesa y registra el modo inseguro | Procesa y registra el modo inseguro |
| `log` | Procesa y registra `twilio_signature_valid` | Procesa y registra `twilio_signature_invalid` o `twilio_signature_missing` | 403 si falta el token o el modo es inválido. Si falta la URL pública, registra el error de configuración y procesa |
| `enforce` | Procesa y registra `twilio_signature_valid` | 403, sin efectos | 403, sin efectos. El arranque también se aborta si faltan token o URL |

El default de código es `off` cuando la variable falta o está vacía. Desplegar este código sin tocar el entorno no empieza a rechazar mensajes. El valor de activación es `log`, escrito en `.env.example`, no en el `.env` local y no en el contenedor que ya estaba corriendo.

Un valor distinto de `off`, `log` o `enforce` no se convierte en `off`. `validateConfig` termina el proceso y, si un request igual llega, responde 403 con `invalid_mode`.

`off` existe para una contingencia excepcional. Acepta requests sin autenticación de Twilio. No es el modo de activación ni el rollback normal.

Cada evento de firma lleva ruta sin query, modo, resultado, razón técnica y un UUID generado por el proceso. No se registra el auth token, la firma, el teléfono, el body ni el query string. De la URL solo salen protocolo, host y pathname.

## 5. Auth token

El token sale de `config.twilioAuthToken`, que nace de `TWILIO_AUTH_TOKEN`.

- `off` sin token: procesa y deja el modo inseguro en el log. El token no se imprime.
- `log` sin token: 403 y `missing_auth_token`. No hay forma de distinguir a Twilio de cualquier otro cliente, así que no se trata como una validación exitosa.
- `enforce` sin token: 403 y el proceso no arranca.

El body se valida con los parámetros decodificados, incluidos los repetidos. El parser de la firma conserva todas las ocurrencias. Express, con `extended: false`, se queda con la última; por eso la firma usa el body crudo y no `req.body`. El controlador sigue recibiendo `req.body` como antes. No se altera el body antes de verificar.

## 6. Integración con TB-006

No se cambió la adquisición, el fencing, el reclaim, el replay del TwiML, `FAILED`, `DEAD_LETTER` ni la clave outbound.

Un 403 de firma ocurre antes de `beginInboundEvent`. No inserta `provider_webhook_events`, no crea conversación y no llama al FlowEngine.

Una firma válida entra al mismo `settleTwilioInbound`. Un retry legítimo con el mismo `MessageSid` sigue siendo un solo procesamiento y devuelve el TwiML guardado.

`log` con firma inválida procesa el turno con la misma semántica de siempre. El registro de seguridad no cambia el resultado del turno.

Si la firma es válida y la adquisición SQL falla, la respuesta sigue siendo 503. No se procesa sin idempotencia y no se informa como firma inválida. La prueba lo cubre con un `begin` que lanza: la evaluación de firma queda `valid` y el HTTP del turno queda 503.

## 7. Evidencia HTTP

Servidor Express en `127.0.0.1`, puerto efímero, sin salida a internet y sin webhook real. La firma se genera y se verifica con la librería `twilio` del proyecto.

Quedaron cubiertos T01 a T12, T17, T18, parámetros repetidos, UTF-8 y el 503 de SQL. El detalle está en `implementation-tests.txt`.

## 8. Evidencia SQL

Base confirmada: `tea-bot` en `localhost:1433`. `TB_SQL_TEST_CONFIRM=tea-bot`. `DB_NAME()` coincidió.

Lectura de `schema_migrations`: 007, 008 y 010 con éxito. 009 ausente. No se ejecutó ninguna migración.

Los POST inválidos en `enforce` dejaron cero filas de evento y cero mensajes. Dos POST válidos con el mismo SID dejaron un `PROCESSED` con un intento y un solo inbound. Una firma inválida no impidió después procesar el mismo SID. La reentrada firmada devolvió el prompt y pasó a `awaiting_choice`. Con el takeover apagado, el turno firmado quedó en `bot`.

Los teléfonos y SID eran fixtures. Se borraron al cerrar cada prueba. Una consulta posterior no encontró esas conversaciones ni eventos `SMT*`.

## 9. Callback de estado

`verifyTwilioSignature` no consulta `TWILIO_SIGNATURE_MODE`. Con el inbound en `off`, `log` y `enforce`, una firma de status inválida o ausente sigue en 403 y no llama a `recordDeliveryStatus`. Una firma válida sigue en 200.

El único cambio lateral: un body que el parser rechaza en `/webhooks/twilio` ahora responde 400 en texto, también en status. Antes caía al error HTML de Express. No abre el callback ni salta la firma de un body válido.

## 10. Riesgos residuales

- `enforce` con una `APP_BASE_URL` distinta a la URL de Twilio rechaza mensajes reales. Por eso el primer despliegue tiene que ser `log`.
- El default `off` deja el inbound sin autenticar hasta que alguien ponga `log`. El arranque lo avisa. No es silencioso, pero tampoco protege solo por desplegar el código.
- `log` sin URL pública procesa el request y registra el error de configuración. Sirve para no cortar el canal, y no debe leerse como una firma válida.
- El status, si `APP_BASE_URL` no está, sigue armando la URL con el primer `X-Forwarded-*`. El inbound no. Hay que dejar `APP_BASE_URL` puesta también por el status.
- Esta corrida no atraviesa el Nginx ni el TLS del VPS. No demuestra que la URL productiva sea la que Twilio firma.
- `off` acepta cualquier POST con forma de mensaje de WhatsApp.
- El webhook de Meta sigue sin firma. No es parte de TB-005.
- Los logs viejos del pipeline pueden incluir el teléfono. Los eventos nuevos de firma no lo hacen.

## 11. Condiciones para activar enforce

Todas tienen que cumplirse:

1. `TWILIO_AUTH_TOKEN` configurado en el proceso.
2. `APP_BASE_URL` igual al origen público de la consola de Twilio, con `https` y el host real.
3. Si Nginx agrega un prefijo que Express no ve, ese prefijo está en `APP_BASE_URL` o en `TWILIO_PUBLIC_PATH_PREFIX`, no en los dos.
4. Una muestra de mensajes reales en `log` muestra `twilio_signature_valid` con el protocolo, host y pathname esperados.
5. Esa muestra no muestra `twilio_signature_invalid` ni `twilio_signature_missing` para mensajes que sí salieron de Twilio.
6. No hay `public_url_unconfigured` ni `missing_auth_token` en esa muestra.
7. El rollback a `log` está preparado antes de cambiar la variable.

Sin esa muestra, `enforce` no se activa.

## 12. Rollback

De `enforce` a `log`:

1. Cambiar `TWILIO_SIGNATURE_MODE=log`.
2. Reiniciar solo el proceso del bot.
3. No revertir el código.
4. No desactivar la idempotencia SQL ni `provider_webhook_events`.

`log` vuelve a aceptar el tráfico y deja escrito si la firma cierra. Si el token no está disponible y el canal tiene que seguir, `TWILIO_SIGNATURE_MODE=off` es la contingencia. También es un cambio de configuración y un reinicio. `off` no autentica el inbound. El status sigue exigiendo firma en los tres modos.
