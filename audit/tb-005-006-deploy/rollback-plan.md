# Rollback — preparado como procedimiento, no ejecutado

Fecha: 2026-11-10. No hubo promoción, así que no hay rollback que aplicar.

## Antes de un intento futuro

Registrar, en el VPS ya identificado:

- SHA que está corriendo;
- imagen y digest del backend;
- volúmenes que no se pueden borrar;
- comando Compose que hoy levanta solo el backend.

El rollback de aplicación es volver a esa imagen o a ese SHA y reiniciar el backend. No incluye `docker compose down -v` ni borrar volúmenes. El frontend no se reinicia si el cambio es solo del bot.

## Esquema

007, 008 y 010, si se aplican, no se revierten con un drop. El código anterior tiene que poder convivir con esas columnas y tablas, o el rollback de aplicación no alcanza. El backup verificado es recuperación de emergencia, no el camino habitual. No se restaura encima de la base en uso sin una decisión explícita de pérdida de datos posteriores al backup.

009 no entra en este despliegue. Takeover permanece apagado.

## Firma

Si `log` registra mal la URL o rechaza el arranque, se corrige `APP_BASE_URL` o el prefijo y se reinicia. Volver el modo a `off` es la contingencia documentada si `log` cortara tráfico por configuración incompleta. No se apaga la idempotencia de TB-006 para arreglar la firma. No se pasa a `enforce` durante el incidente.

## Esta sesión

No se cambió producción. No existe un SHA nuevo que revertir.
