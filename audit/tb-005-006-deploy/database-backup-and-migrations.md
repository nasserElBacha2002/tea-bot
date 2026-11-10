# Backup y migraciones

Base: `tea_bot` en `dinamicsystems`, SQL Server Developer 16.0.4255.1. Sin linked servers. 123 GB libres en `/`.

## Backup

`/var/opt/mssql/backup/tea_bot_predeploy_20261110T174200Z.bak`

- 23298560 bytes, 2026-11-10 17:38:17 UTC.
- `BACKUP DATABASE [tea_bot] WITH COPY_ONLY, CHECKSUM, COMPRESSION`.
- `RESTORE VERIFYONLY WITH CHECKSUM` sin error, repetido antes de aplicar la 010.

## Historial previo

001 a 008 con `success=1`. 009 ausente. 010 ausente. Sin cambios de esquema concurrentes. `provider_webhook_events` tenía el índice único y las columnas de 007, sin `response_body` y sin check constraints.

## Aplicación de la 010

`migrations/010_webhook_response_body.sql` solo agrega `response_body NVARCHAR(MAX) NULL` si no existe. No tiene `DROP`, `DELETE`, `TRUNCATE`, `UPDATE` ni `INSERT`.

El runner general también aplicaría la 009. No se usó. La 010 se aplicó con `scripts/tb006-preflight.js --apply-010`, en la misma transacción que el `INSERT` de `dbo.schema_migrations` y el checksum del archivo. La autorización fue `TB006_PRODUCTION_CONFIRM=tea_bot` y `TB006_APPLY_010=010_webhook_response_body.sql`. `tea_bot` no se agregó a la allowlist de SQL TEST. `--execute` sigue rechazando ese servidor.

Resultado: `applied: true`. Columna `nvarchar`, `max_length=-1`. 009 sigue ausente. 010 registrada con `success=1`.

## Sonda

Después de la columna, `--probe` insertó solo `TB006-PROBE-8426681c-3aa4-479e-bdda-e3a26eec806b`, leyó el TwiML y borró esa fila.

- `twimlAccepted: true`
- `removed: 1`
- `probeLeft: 0`
- `cleanupFailed: false`
- `protectedUntouched: true` para conversaciones, mensajes, sesiones, handoffs y versiones de flujo
- `ready: true`, exit 0

El flujo publicado sigue siendo `main-menu` v62. El draft v63 no se publicó.
