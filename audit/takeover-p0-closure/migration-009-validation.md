# Validación de la migración 009

Alcance: base local `tea-bot` en `localhost`, instancia `c60449e5dbda`, SQL Server 2022 CU24 (16.0.4245.2). No se creó otra base. No se tocó `tea_bot`.

## Antes

Identidad: `DB_NAME()` = `tea-bot`.

`schema_migrations` tenía 001 a 008 y 010 con `success=1`. 009 ausente.

`dbo.conversations` tenía `reentry_json`. No tenía `status_version`. No existía `dbo.conversation_operation_requests`.

Conteos: 15 conversaciones (10 `assigned`, 5 `bot`), 44 mensajes, 3 handoffs, 6 sesiones. Cero grupos con más de un handoff `pending` o `assigned`. Nueve de las diez `assigned` no tienen `assigned_agent_id`. Eso ya estaba y no se reescribió.

009 es aditiva. No tiene `DROP`, `DELETE`, `UPDATE` ni `INSERT` de negocio. No pisa 007, 008 ni 010: 007 y 010 son `provider_webhook_events`; 008 es `reentry_json`.

## Backup

Archivo dentro del contenedor `sqlserver`:

`/var/opt/mssql/backup/tea-bot_pre009_20261110T181500Z.bak`

3129344 bytes. `BACKUP DATABASE [tea-bot] WITH COPY_ONLY, CHECKSUM, COMPRESSION, INIT`. `RESTORE VERIFYONLY FROM DISK ... WITH CHECKSUM` terminó sin error.

## Aplicación

`npm run db:migrate` en `whatsapp-bot`. El runner registró el checksum y `success=1` en la misma transacción que los dos lotes.

Resultado del runner: `applied 009_conversation_status_version.sql`. 001 a 008 y 010 quedaron en skip. No se modificó el archivo de la migración.

## Después

- `status_version`: `int`, `is_nullable=0`, default `((0))`.
- Las 15 filas históricas quedaron en `0`. Cero nulos.
- Conteos de conversaciones, mensajes, handoffs y sesiones iguales al backup.
- `UQ_conversation_operation_request` único sobre `(conversation_id, operation, client_request_id)`.
- La tabla de solicitudes quedó en 0 filas después de la suite: los tests borran sus fixtures.

## Compatibilidad del código ya desplegado

El SHA productivo conocido selecciona columnas en el `INSERT` y no incluye `status_version`. El default 0 alcanza. Con el flag apagado, el proceso actual no exige la columna. Encender el flag sobre una base sin 009 responde `TAKEOVER_SCHEMA_REQUIRED` y no autoriza una respuesta automática de una fila persistida. Por eso el plan productivo aplica 009 antes de encender el flag.

## Pendiente

Aplicar 009 en `tea_bot`. No se hizo.
