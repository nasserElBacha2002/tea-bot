# Ejecución del despliegue

Fecha: 2026-11-10. El backend productivo se recreó. SQL Server, Nginx y el frontend no se reiniciaron.

## Antes de sustituir la imagen

- Checkout del VPS limpio en `9b2ff0be71058a11713b97146a20f683b631eda5`.
- `git fetch origin` trajo `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937`. Fast-forward, sin cambios locales que perder.
- Imagen anterior conservada como `tea-whatsapp-bot:rollback-9b2ff0be7105`, digest `sha256:8a95d51f9fe842b1eecf2c28fc940285413b5a3039e7ae1a77e29251c03977ec`.
- Backup `tea_bot_predeploy_20261110T174200Z.bak` vuelto a verificar con `RESTORE VERIFYONLY WITH CHECKSUM`.
- Migración 010 aplicada y sonda TB-006 con `ready: true` antes del build.
- Preflight de firma, con el token ya presente en el contenedor y las variables nuevas, salió 0.

## Cambio de entorno

En `/home/nasser/tea-bot/whatsapp-bot/.env`, con copia previa en `.env.before-tb005-log`:

- `APP_BASE_URL=https://bot.dinamiceducation.com`
- `TWILIO_SIGNATURE_MODE=log`
- `MANUAL_TAKEOVER_ENABLED=false`
- `TWILIO_PUBLIC_PATH_PREFIX` ausente

No se copió el `.env` local. No se imprimieron secretos.

## Build y recreación

Directorio `/home/nasser/tea-bot`, Compose del proyecto `tea-bot`.

- `docker compose build whatsapp-bot`
- Tag `tea-whatsapp-bot:2ccaeb6e7b5b`, digest `sha256:2e22dea94b8f1c458782be366a4464f43ab16103de91cfc40fe36ebbc47cdec6`
- `docker compose up -d --no-deps --force-recreate whatsapp-bot`

No se usó `docker compose down -v`. No se borraron volúmenes. El frontend sigue creado el 2026-11-05T17:09:38Z.

## Resultado

Contenedor `tea-whatsapp-bot` creado 2026-11-10T17:55:32Z, healthy, 0 reinicios. El checkout del host quedó en `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937`. El proceso arrancó con `mode=log`, `ready=true`, `configurationState=observing` y `enforceReady=false`.
