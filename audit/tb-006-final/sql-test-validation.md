# Validación SQL de TB-006

## Docker

Estado inicial:

- `sqlserver` (`mcr.microsoft.com/mssql/server:2022-latest`) ya estaba Up, con `1433` publicado en `0.0.0.0`. Es Developer Edition. No está en `docker-compose.yml`.
- `tea-whatsapp-bot` estaba en restart. Sale antes de escuchar: faltan `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN` y `META_PHONE_NUMBER_ID`. No se reparó, porque dejarlo sano abriría el proceso que recibe webhooks.
- `tea-frontend` estaba en Created. Su imagen apunta a `http://170.239.85.196:3000`. No se inició.
- No se ejecutó `docker compose up`. El compose no contiene SQL Server y sí contiene el bot de webhooks y el frontend. No se reinició ningún volumen.

## Instancia y base

- Servidor configurado: `localhost`.
- Puerto: `1433`.
- Base configurada y `DB_NAME()`: `tea-bot`.
- Instancia: `c60449e5dbda`.
- Cliente visto por SQL: `192.168.65.1`. Dirección local del contenedor: `172.17.0.2`.
- Linked servers: 0.
- La suite imprimió `sql_test_identity` con esa misma base e instancia.
- No se imprimió la contraseña ni la cadena de conexión.

## Migraciones

Antes de 010 estaban aplicadas 001 a 008, todas con `success`. 009 y 010 no estaban. `response_body` no existía.

Se aplicó solo `010_webhook_response_body.sql`. 007 no se editó ni se volvió a ejecutar. 009 sigue sin aplicar.

Después, `sys.columns` muestra `response_body` como `nvarchar` con `max_length = -1`, y `schema_migrations` tiene 010 con `success`.

## Backup

Antes del `ALTER`:

- `BACKUP DATABASE [tea-bot] TO DISK = /var/opt/mssql/data/tea-bot-tb006-pre010.bak WITH INIT, CHECKSUM`
- `RESTORE VERIFYONLY ... WITH CHECKSUM` terminó sin error.
- Archivo en el contenedor: 20M. Copia local: `/tmp/tea-bot-tb006/tea-bot-tb006-pre010.bak`, 19M.
- No se hizo `DROP`, `TRUNCATE` ni limpieza de tablas compartidas.

## Pruebas ejecutadas

Contra `tea-bot`, con fixtures nuevos y limpieza por su propio id o `provider_message_id`:

1. Dos acquires concurrentes del mismo MessageSid: un process y un skip `in_flight`.
2. Dos inserts del mismo id: uno cumple y el otro recibe 2601 o 2627.
3. Reclaim de un `PROCESSING` vencido, solo sobre el fixture.
4. El worker anterior no inserta el mensaje después de perder el lease.
5. El worker anterior no cierra el evento reclamado.
6. `FAILED` se vuelve a adquirir por debajo del máximo.
7. El máximo pasa a `DEAD_LETTER` y el siguiente request no procesa.
8. El outbound y el handoff no se duplican. El SID de 128 caracteres tampoco.
9. La reentrada del mismo MessageSid se aplica una vez en SQL.
10. El TwiML guardado se lee igual en el retry.
11. Con `monitoringEnabled` forzado a false, el segundo begin no procesa.
12. Takeover apagado: un esquema ausente queda `FAILED`, no `PROCESSED`.
13. El ciclo de sesiones y el cursor de reentrada quedan coherentes en las integraciones que sí corrieron.
14. La auditoría del mismo efecto inserta una fila; otra acción se conserva.

La retención contó primero las conversaciones anteriores a `2000-01-15`. Había cero, así que corrió y solo pudo alcanzar los fixtures que ella misma creó. Si hubiera habido alguna, el test se habría salteado.

## Omitidas

Dos pruebas de takeover encendido. Piden 009. No se aplicó 009 y no se debilitaron sus assertions. No cuentan como aprobadas.

## Fixtures

Antes de la primera suite: 15 conversaciones, 44 mensajes, 3 handoffs, 6 sesiones, 0 webhook events, 25 auditorías.

Después de la suite verde, los mismos conteos. Cero ids previos ausentes y cero conversaciones agregadas. Cero filas en `provider_webhook_events`. El probe de TwiML se revirtió y `probeLeft` fue 0.

Una consulta por prefijos `IDEM-`, `IT-`, `RET-`, `ACT-` y `SM-` encuentra 9 conversaciones. Esas 9 ya estaban en la foto inicial. No se borraron.

Quedan 6 auditorías `conversation.retention_fixture` que ya formaban parte de las 25 iniciales. El conteo no subió.

## Residual

WhatsApp no queda exactly-once. Un motor que no escribe durante toda la ventana de reclaim puede correr en dos procesos; solo el dueño del fence commitea. La auditoría no tiene índice único: la garantía es el lock dentro de `record()`.

## Merge y deploy

El cierre está listo para revisión y no está commiteado. El deploy de otro entorno necesita su propio backup, la 010, y `tb006-preflight.js --execute` con `ready: true` antes de recibir tráfico. Esta sesión no tocó el VPS, Twilio, Nginx ni producción.
