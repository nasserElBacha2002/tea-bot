# Tea Bot — Roadmap actualizado

**Fecha:** 10/11/2026.  
**Base:** Plan v1.1, más el commit local `06f26d8` que ya escribió la toma y todavía no está en `origin/main`.

La primera etapa sigue siendo seguridad, confiabilidad del procesamiento y estabilidad operativa. TB-016, TB-017 y TB-018 quedan después. TB-019 no es una entrega nueva.

## Ejecutable ahora

Estas entregas no necesitan el servidor de producción ni encender flags.

### E0 — Congelar la toma sin activarla

- **Tickets:** TB-002, TB-003, TB-004, TB-019. Ya implementados.
- **Objetivo:** no mergear ni desplegar `06f26d8` como función activa. El flag queda apagado.
- **Dependencias:** ninguna de código.
- **Archivos:** no se tocan. La evidencia está en `audit/takeover-corrections/`.
- **Tests:** no repetir diseño. La barrera es E1.
- **Riesgo:** bajo si nadie exporta `MANUAL_TAKEOVER_ENABLED=true` sobre una base sin 009.
- **Aceptación:** `origin` no recibe el flag encendido. La conversación `assigned` existente se sigue atendiendo con el inbox anterior.

### E1 — Base aislada y migración 009

- **Tickets:** TB-002, TB-003, TB-004.
- **Objetivo:** una base local cuyo nombre contenga `test`, aplicar 001–009 ahí, correr las dos pruebas que hoy hacen skip.
- **Dependencias:** SQL Server local. No usar `tea-bot` para esas dos pruebas: el filtro las rechaza a propósito.
- **Archivos:** `migrations/009_conversation_status_version.sql`, `conversation-takeover.integration.test.js`.
- **Tests:** `integration: toma manual exclusiva en SQL TEST` y `integration: dos agentes en paralelo sobre SQL real`.
- **Riesgo:** medio si se apunta el runner a la base equivocada. El filtro actual cubre solo esas dos pruebas. El resto de las integraciones escribe en la base que tenga el `.env`.
- **Aceptación:** las dos pruebas pasan, el rollback del flag está escrito, y no se dropea `status_version`. Recién ahí el commit puede ir a `origin` con el flag apagado.
- **Bloqueo:** falta la base aislada. Crear esa base es infraestructura local, no un cambio de producto.

### E2 — Idempotencia SQL siempre activa

- **Ticket:** TB-006.
- **Objetivo:** el `MessageSid` se adquiere en `provider_webhook_events` aunque `MONITORING_ENABLED` sea falso. El archivo `webhook-processed-ids` deja de marcarse antes del turno.
- **Dependencias:** migración 007 presente. En local ya está. En producción hay que confirmarla con la consulta de `tea-bot-validation-evidence.md` antes de desplegar.
- **Archivos:** `twilio-webhook.controller.js`, `webhook-events.service.js`, `monitoring.repository.js`, `webhook-dedupe.service.js`.
- **Tests:** T07, T08 y T09 del plan. El caso T09 tiene que correr con el flag explícitamente apagado. Los tests actuales de acquire cubren el camino con base, no el flag apagado.
- **Riesgo:** medio. Si 007 no está en el servidor, el webhook no debe caer a “procesar y marcar el archivo”. Tiene que quedar `FAILED` retryable o rechazar el turno de forma visible.
- **Aceptación:** dos procesos y un retry no duplican efecto. Un crash entre acquire y commit se puede reclamar. El monitoreo puede estar apagado.

### E3 — Firma del inbound en modo log

- **Ticket:** TB-005.
- **Objetivo:** calcular la firma, loguear válido o inválido, y seguir procesando. Documentar `APP_BASE_URL` igual a la URL del webhook de Twilio, incluyendo el prefijo que agrega Nginx.
- **Dependencias:** puede ir en paralelo con E2. No activar `enforce` en el mismo cambio.
- **Archivos:** `verify-twilio-signature.js`, `twilio-webhook.routes.js`, `.env.example`.
- **Tests:** firma válida, firma inválida en `log` (procesa), firma inválida en `enforce` (403 y cero persistencia), URL con `X-Forwarded-Proto`.
- **Riesgo:** bajo en `log`. Alto si alguien pasa a `enforce` con la URL mal armada.
- **Aceptación:** una muestra de webhooks reales, o de un túnel de prueba, muestra coincidencia de URL antes de cambiar el default a `enforce`.

## Después de E2 y E3, todavía dentro de la primera etapa

### E4 — Hash con salt y permiso explícito

- **Ticket:** TB-007.
- **Objetivo:** en un login válido, si el hash guardado es SHA-256, verificarlo y reemplazarlo por bcrypt o Argon2id. Mantener las sesiones ya emitidas hasta que expiren.
- **Dependencias:** decisión de una sola librería. Hoy no hay ninguna. El token sin rol que se lee como admin se corrige en un cambio separado, con aviso de que las cookies viejas pierden el atajo.
- **Archivos:** `admin-auth.service.js`, `config.js`, `roles.js`, `.env.example`, README.
- **Tests:** login con hash viejo reescribe; el siguiente login ya no acepta solo el hex; operador no queda admin.
- **Riesgo:** medio por invalidar el formato que `validateConfig` hoy exige al arrancar. El proceso tiene que aceptar ambos formatos durante la transición.
- **Aceptación:** un `.env` con el hash viejo sigue entrando una vez, y el secreto deja de ser un SHA-256 sin salt.

### E5 — Readiness mínimo

- **Ticket:** TB-013, la parte que la primera etapa pide.
- **Objetivo:** `GET /livez` responde si el proceso vive. `GET /readyz` falla si la base no responde o si no hay un flujo publicado cargable. `/health` queda como está hasta cambiar el healthcheck de Compose en un paso posterior.
- **Dependencias:** ninguna de la toma.
- **Archivos:** `app.js`, `Dockerfile`, `docker-compose.yml` solo cuando `/readyz` ya se vio en local.
- **Tests:** base caída devuelve no listo; flujo ausente devuelve no listo; no incluye secretos en el JSON.
- **Riesgo:** bajo si Compose sigue en `/health` hasta verificar el endpoint.
- **Aceptación:** un deploy puede distinguir proceso vivo de base caída.

### E6 — CI que bloquee merge

- **Tickets:** el gate de la sección 4.4 del plan.
- **Objetivo:** en el remoto, lint y typecheck de frontend, tests de backend que no escriben en una base arbitraria, y build. Las integraciones SQL quedan en un job que solo corre si existe una base de test.
- **Dependencias:** E1 para el job SQL. El job sin base puede existir antes.
- **Archivos:** workflow nuevo. No hay uno que extender.
- **Tests:** el workflow mismo es la prueba.
- **Riesgo:** bajo. El primer workflow no debe llamar `db:migrate` contra producción.
- **Aceptación:** un push con un test roto no queda mergeable.

## Bloqueado por validación o por infraestructura

| Entrega | Bloqueo | Qué lo destraba |
|---|---|---|
| Encender `MANUAL_TAKEOVER_ENABLED` | 009 no aplicada. Prueba de dos agentes no corrida. Commit fuera de `origin`. | E1, y recién en el servidor después de confirmar 008 y 009. |
| `enforce` de la firma | No hay medición de la URL pública. | E3 en log, con el host real. |
| TB-012, SQL como única autoridad de sesión | El motor todavía decide con `sessions.json`. Cortarlo ahora pierde cursores. | Después de E2. Dual-read, luego un reinicio de prueba. |
| TB-009 alertas de atasco | No hay señales. | TB-008 en shadow, sin cambiar respuestas. |
| TB-010 matching nuevo | Puede cambiar el flujo publicado. | Replay del flujo vigente y flag de vuelta al matching anterior. |
| TB-015 y TB-024 cifras de octubre | No se consultó Twilio ni la base productiva. | Credenciales de solo lectura y la zona horaria acordada. |
| TB-021 enviar archivos | No hay almacenamiento privado ni URL temporal para Twilio. | TB-020 primero. Si no hay forma segura de que Twilio lea el archivo, el ticket se detiene. |

## Después de la primera etapa, en este orden

1. **TB-008 en shadow y TB-009 como alerta**, usando el botón de toma ya construido. Sin handoff automático.
2. **TB-010 y TB-011**, con fixtures del flujo publicado. El caso de 80 mensajes y el falso positivo `inscripciones` / `si` son la aceptación.
3. **TB-022**, completar búsqueda sobre el `LIKE` actual: fragmento, salto al mensaje, placeholder honesto. FULLTEXT solo si una medición lo pide.
4. **TB-014 y TB-013 de actividad por transporte**, después **TB-015**, **TB-023** y **TB-024**.
5. **TB-020** recibir medios. **TB-021** al final de ese bloque.
6. **TB-012** cutover de sesiones, cuando E2 ya esté en el proceso real.
7. **TB-016** y **TB-017** solo con una métrica o con un feature que los necesite.
8. **TB-018** templates proactivos, con demanda operativa explícita.

## Criterio de primera etapa cerrada

Las ocho condiciones, todas:

1. Reentrada comprobada en el entorno que atiende mensajes, con 008 aplicada y policy `prompt`.
2. Toma en `origin`, flag disponible y apagado hasta pasar E1 en una base aislada; al encenderla, 009 ya aplicada y dos agentes probados.
3. Inbound con firma en `enforce` después de una muestra en `log`.
4. Idempotencia SQL con el monitoreo apagado.
5. Password con salt y sin el atajo de token admin.
6. Decisión explícita de sesión: o SQL ya es autoridad, o queda un corte fechado. Hoy el JSON sigue mandando en el turno.
7. `/livez` y `/readyz` separados.
8. CI bloqueando merge, y una nota de qué commit quedó desplegado.

Hasta que eso ocurra, la primera etapa no está cerrada aunque la toma ya tenga código.
