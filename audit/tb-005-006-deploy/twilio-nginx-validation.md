# Twilio y Nginx — no verificados

Fecha: 2026-11-10. No se modificó Twilio Console ni Nginx.

## Bloqueo

TB-005 reconstruye la URL firmada así:

- origen y, como máximo, un prefijo, desde `APP_BASE_URL` y `TWILIO_PUBLIC_PATH_PREFIX`;
- ruta y query desde lo que Express recibe;
- sin `X-Forwarded-*`.

El callback de estado usa esa misma URL y exige firma en todos los modos. Si `APP_BASE_URL` no es el origen público real, o el prefijo está en los dos lugares, `log` no arranca. Si el prefijo no coincide con lo que Nginx quita o conserva, las firmas válidas se registran como inválidas.

No hay evidencia de:

- `server_name`, `listen 443 ssl` ni certificados del VPS;
- `location` del webhook, `proxy_pass` y si el prefijo se elimina o se conserva;
- la URL inbound de WhatsApp en Twilio;
- la URL del status callback en Twilio;
- presencia de `TWILIO_AUTH_TOKEN` en el entorno productivo, sin imprimir su valor.

`frontend/nginx.conf` del repositorio no es ese proxy. Las pruebas locales firmaron contra `https://bot.example`.

## Preflight de firma

`node scripts/twilio-signature-preflight.js` no se corrió contra la configuración productiva. En el `.env` local, el mismo día, el modo efectivo era `off`, sin token y sin `APP_BASE_URL`, con exit 2. Esa corrida no autoriza `log` en producción.

## Condición para continuar

Hace falta la URL pública real del inbound y del status, la ruta que Express ve, y un solo lugar para el prefijo. Con eso, el preflight productivo tiene que devolver `mode: log`, `ready: true`, `logReady: true`, `configurationState: observing` y exit 0. `enforce` queda fuera de este despliegue.
