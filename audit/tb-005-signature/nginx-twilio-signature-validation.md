# Validación de la firma Twilio detrás de Nginx

Esta guía no modifica Nginx. El repositorio no tiene un reverse proxy delante del bot. `frontend/nginx.conf` solo sirve el frontend. `docker-compose.yml` publica el bot en el puerto 3000 y no termina TLS.

No se tocó el Nginx del VPS. No se activó `enforce`.

## Qué tiene que coincidir

Twilio firma la URL exacta configurada en el webhook, más los campos del formulario. El backend inbound no reconstruye esa URL desde `X-Forwarded-*`. La arma con:

- `APP_BASE_URL`
- `TWILIO_PUBLIC_PATH_PREFIX`, solo si Express no recibe un prefijo que la URL pública sí tiene
- la ruta y el query que llegaron a Express

Si esa concatenación no es la URL de la consola de Twilio, `enforce` va a responder 403 a mensajes reales.

## Qué mirar antes de salir de log

1. En Twilio Console, anotar la webhook URL del número de WhatsApp, incluido `https`, host, puerto si no es 443, prefijo y ruta. Ejemplo esperado por el código: `https://<dominio>/webhooks/twilio/<flowId>`.
2. Confirmar que el certificado cubre ese host.
3. Confirmar en Nginx:
   - el `server_name` y el `listen 443 ssl`
   - si hay un prefijo (`location /tea/`) y si `proxy_pass` lo elimina
   - que el query string se reenvía
   - que el body `application/x-www-form-urlencoded` no se reescribe
4. Anotar los headers que Nginx agrega. Pueden existir `X-Forwarded-Proto` y `X-Forwarded-Host`. El inbound de TB-005 no los usa para validar. No hace falta confiar en ellos para la firma. Sí conviene que Nginx los pise y no los copie de un cliente, por el resto de la aplicación y por el callback de estado cuando `APP_BASE_URL` no está.
5. Poner en el entorno del bot, sin activar `enforce`:

```
TWILIO_SIGNATURE_MODE=log
APP_BASE_URL=https://<dominio-publico>
TWILIO_AUTH_TOKEN=<token del mismo proyecto Twilio>
```

Si Nginx publica `https://<dominio>/tea/webhooks/twilio/...` y el proceso recibe `/webhooks/twilio/...`, usar una de estas dos formas, no las dos:

```
APP_BASE_URL=https://<dominio>/tea
```

o

```
APP_BASE_URL=https://<dominio>
TWILIO_PUBLIC_PATH_PREFIX=/tea
```

6. Reiniciar el proceso del bot. No hace falta cambiar la idempotencia.
7. Enviar un mensaje real de WhatsApp al número.
8. Buscar en los logs del proceso un JSON con `event` igual a uno de estos:

- `twilio_signature_valid`
- `twilio_signature_invalid`
- `twilio_signature_missing`
- `twilio_signature_configuration_error`

9. En un mensaje que sí vino de Twilio, el resultado esperado en `log` es `twilio_signature_valid`. El objeto `url` debe mostrar `protocol` `https`, el host público y el pathname público. No debe traer query string.
10. Si el resultado es `invalid`, comparar solo protocolo, host y pathname con la URL de Twilio. Los desvíos típicos son `http` contra `https`, un host interno, un puerto o un prefijo de más o de menos. Corregir `APP_BASE_URL` o el prefijo y repetir. No pasar a `enforce` mientras un mensaje real siga en `invalid`.
11. `missing_auth_token` o `public_url_unconfigured` significan que la configuración no alcanza para verificar. `enforce` no debe arrancar así: el proceso termina al inicio si faltan el token o la URL.

El log de firma no incluye el token, la firma, el teléfono, el texto del mensaje ni el query. No hay que agregarlos para diagnosticar.

## Ejemplo de location

No aplicar este bloque sobre el servidor productivo desde esta tarea. Es la forma que encaja con el código si el backend escucha en `127.0.0.1:3000` y la URL pública no tiene prefijo:

```
location /webhooks/twilio/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

`proxy_pass` sin URI de reemplazo conserva la ruta y el query. Un `proxy_pass` con ruta propia puede borrar el prefijo o el query y hacer que la firma no cierre.

Si el location es `/tea/` y se reescribe hacia `/`, Express ve `/webhooks/twilio/...` mientras Twilio firmó `/tea/webhooks/twilio/...`. Ahí entra el prefijo documentado arriba.

## Rollback

Si `enforce` rechaza mensajes legítimos:

1. Volver `TWILIO_SIGNATURE_MODE` a `log`.
2. Reiniciar el proceso.
3. No revertir el código y no apagar la idempotencia de TB-006.

`off` queda para una contingencia en la que ni siquiera se puede verificar. En `off` el inbound acepta requests sin firma. El callback `POST /webhooks/twilio/:flowId/status` sigue exigiendo firma en `off`, `log` y `enforce`.

## Lo que esta corrida no demuestra

Las pruebas locales firmaron contra `https://bot.example` en un Express de `127.0.0.1`. Eso prueba el código y el contrato de Twilio. No prueba el host, el certificado ni la reescritura del VPS. `enforce` en producción espera la muestra del paso 9.
