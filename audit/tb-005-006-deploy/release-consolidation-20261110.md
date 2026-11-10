# Release — detenido antes del despliegue

Fecha: 2026-11-10. Estado: `BLOCKED_PREDEPLOY`.

No se desplegó. No se aplicó la migración 010. No se aplicó la 009. No se activó `TWILIO_SIGNATURE_MODE`. No se activó `enforce`. No se activó takeover. No se reinició Docker, Nginx ni SQL Server. No hubo push en esta sesión.

## Verificaciones completadas

- Rama única `main`. Working tree limpio al empezar. No hay cambios sin commit de TB-005, TB-006 ni del matching.
- `git fetch`: local y `origin/main` están en el mismo SHA.
- Barrido de `main-menu` v62: 89 nodos, 26 reglas `matchIncludes`, 279 opciones publicadas. Ninguna regla queda fuera por tener menos de 3 caracteres. Ninguna etiqueta publicada va a un destino distinto de su número. No hay claves exactas ambiguas.
- Suite en `whatsapp-bot`, con la base local `tea-bot` declarada: 426 pruebas, 424 aprobadas, 0 fallas, 2 omitidas. Las dos omitidas piden la migración 009. Exit 0.
- VPS autorizado: `nasser@170.239.85.196:37783`, hostname `dinamicsystems`. Proyecto `/home/nasser/tea-bot`, Compose `tea-bot`.
- Contenedores de este proyecto: `tea-whatsapp-bot` healthy, `tea-frontend` up. Imagen del bot `tea-whatsapp-bot:local`, digest `sha256:8a95d51f9fe842b1eecf2c28fc940285413b5a3039e7ae1a77e29251c03977ec`, creada 2026-11-05.
- SQL que usa el bot: `DB_NAME()=tea_bot`, `@@SERVERNAME=dinamicsystems`, Developer Edition 16.0.4255.1, archivos `/var/opt/mssql/data/tea_bot.mdf` (142606336 bytes) y `tea_bot_log.ldf` (478150656 bytes). Sin linked servers.
- Migraciones registradas con éxito: 001 a 008. 009 ausente. 010 ausente. `dbo.provider_webhook_events` no tiene `response_body`. El índice único `UQ_provider_webhook_events_message` existe. No hay check constraints en esa tabla.
- Flujo publicado: `main-menu` v62, entrada `collect_email`. Existe un draft v63. No se publicó.
- Nginx de Tea Bot: `bot.dinamiceducation.com`, `listen 443 ssl`, `proxy_pass http://127.0.0.1:3000`, el path se conserva. El puerto 80 redirige a HTTPS. `GET /health` responde 200 en `http://127.0.0.1:3000` y en `https://bot.dinamiceducation.com`.
- Variables efectivas del bot, sin secretos: `APP_BASE_URL=http://170.239.85.196:3000`, `TWILIO_PUBLIC_PATH_PREFIX` ausente, `TWILIO_SIGNATURE_MODE` ausente, `MANUAL_TAKEOVER_ENABLED` ausente, `DB_SERVER=host.docker.internal`, `DB_PORT=1433`, `DB_NAME=tea_bot`, `FLOW_STORAGE_MODE=db`, `NODE_ENV=development`, `ALLOW_DEV_SEED=false`. El auth token está presente.
- Preflight de firma, corrido en local con la URL productiva y un token no vacío: `mode=log`, `ready=true`, `logReady=true`, `configurationState=observing`, `enforceReady=false`, `productionUrlVerified=false`, exit 0. La imagen que está corriendo no contiene ese script, así que no se ejecutó dentro del contenedor y no se cambió el entorno.
- Un POST sin firma a `/webhooks/twilio/main-menu/status` responde 403 tanto en el puerto 3000 como detrás de Nginx.
- GitHub Actions del repositorio: 0 workflows. En el VPS no hay crontab de usuario y los hooks de `.git/hooks` son samples. El SHA productivo no cambió después del push de hoy.
- Backup nuevo: `/var/opt/mssql/backup/tea_bot_predeploy_20261110T174200Z.bak`, 23298560 bytes, 2026-11-10 17:38:17 UTC. `BACKUP` con `COPY_ONLY, CHECKSUM, COMPRESSION`. `RESTORE VERIFYONLY WITH CHECKSUM` terminó sin error.

## Bloqueos resueltos

- El VPS, el usuario, el directorio, el Compose y el SHA productivo quedaron identificados con el acceso autorizado. No se usaron claves de otros proyectos.
- TB-005, TB-006 y el matching ya están en `main` y en `origin/main`. No hacía falta otro commit para incluirlos.
- El barrido no encontró una regresión de opciones publicadas. Las etiquetas que antes caían en otro nodo por substring ahora siguen a su número.
- El push a `main` no disparó un despliegue. Producción sigue en el SHA del 5 de noviembre.
- El rollback de aplicación queda identificado: la imagen y el SHA que están corriendo no se reemplazaron.

## Bloqueos pendientes

`node scripts/tb006-preflight.js --execute` no puede examinar esta base.

- Con `DB_SERVER=host.docker.internal` y `DB_NAME=tea_bot` sale 2: el servidor no está en la lista local. No abre conexión.
- Con `DB_SERVER=127.0.0.1` y `DB_NAME=tea_bot` sale 2: el nombre no es `tea-bot` ni `tea_bot_test_<sufijo>`. No abre conexión.

Aunque se salteara ese guard, el esquema no estaría listo: falta la 010 y la columna `response_body`. No se aplicó la 010 por fuera del script.

El preflight de firma con la forma de la URL actual da `ready: true` para `log`, y `productionUrlVerified` queda false. En los access logs de Nginx, Tea Bot tiene 170 `POST /webhooks/twilio/main-menu` con 200. El único `POST /webhooks/twilio/main-menu/status` es un 403, coherente con la sonda sin firma de esta revisión. No hay un callback de estado firmado y aceptado para confirmar la URL que Twilio firma.

## SHA

| Lugar | SHA |
| --- | --- |
| Local `main` | `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937` |
| `origin/main` | `2ccaeb6e7b5b2d904c4b3c5063b7d6433f64c937` |
| Productivo, `/home/nasser/tea-bot` | `9b2ff0be71058a11713b97146a20f683b631eda5` |

## Migraciones

En `tea_bot`: 007 y 008 aplicadas. 009 ausente y fuera de este despliegue. 010 ausente, no aplicada.

## Despliegue

No ejecutado. Los contenedores siguen los que se crearon el 2026-11-05. `TWILIO_SIGNATURE_MODE` sigue sin definirse. Takeover sigue apagado.

## Evidencia de funcionamiento

El bot que está en producción responde. `GET /health` da 200 por el puerto 3000 y por `https://bot.dinamiceducation.com`. En el access log de hoy y de ayer hay 170 ingresos de Twilio a `/webhooks/twilio/main-menu` con HTTP 200. Eso es el binario actual, no el SHA `2ccaeb6`.

## Barrido del matching

Contra `main-menu.json` v62 y el motor de `2ccaeb6`:

- 26 `matchIncludes`. Cero descartadas por largo.
- Un needle cambia solo al quitar la tilde: `información` pasa a `informacion` en `si_cursos_menu`, con el mismo destino `si_cursos_info`.
- 279 opciones numeradas. La etiqueta y el número terminan en el mismo nodo en las 279.
- Frente al matcher anterior hay 251 destinos distintos. Todos quedan alineados con el número. 248 antes iban al `default`. Tres iban a otro nodo por substring y ahora van al de la opción: `carreras a distancia`, `blanqueo de mail institucional` y `periodismo general`.
