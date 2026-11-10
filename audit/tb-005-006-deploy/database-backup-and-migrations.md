# Backup y migraciones — no ejecutados

Fecha: 2026-11-10.

No se aplicó ninguna migración y no se creó backup. La base productiva no está identificada. El nombre local `tea-bot` no se usa como nombre de producción.

## Lo que se sabe solo del entorno local

La corrida de TB-005 contra SQL local, el mismo día, vio:

- `DB_NAME()` = `tea-bot`
- servidor `localhost:1433`
- instancia `c60449e5dbda`
- migraciones 007, 008 y 010 presentes en esa base local
- migración 009 ausente
- `MANUAL_TAKEOVER_ENABLED` no habilitado

Eso no describe el SQL del VPS. Edición, versión, historial y conectividad productivos siguen sin verificar.

## Pendiente antes de cualquier migración

1. Confirmar servidor, instancia y nombre de la base productiva.
2. Leer el historial de 007, 008, 009 y 010 en esa base.
3. Crear un backup nuevo, sin pisar uno anterior.
4. Verificarlo con `RESTORE VERIFYONLY WITH CHECKSUM`.
5. Registrar ruta, tamaño, fecha y espacio de restauración.
6. Aplicar solo 007, 008 si hace falta, y 010, con el runner oficial y en orden.
7. No aplicar 009.
8. Correr `node scripts/tb006-preflight.js --execute` y exigir `ready: true`, `twimlAccepted: true`, `probeLeft: 0`.

Si el preflight falla, el bot nuevo no se reinicia.

## Esta sesión

- Backup: no creado.
- `RESTORE VERIFYONLY`: no ejecutado.
- Migraciones productivas: no leídas y no aplicadas.
- Preflight TB-006 en producción: no ejecutado.
