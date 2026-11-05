# Estrategia de pruebas

No se reejecutó la suite en esta auditoría. Los tests de integración escriben y borran filas, y no se confirmó que `.env` apunte a una base TEST aislada de producción.

Estado de cada prueba del plan v1.1:

| ID | Qué demuestra | Hoy | Cuándo se exige |
|---|---|---|---|
| T01 | Toma desde `bot` deja `assigned` y frena el motor | No existe. El test de reentrada cubre lo contrario: claim en `bot` → `CONVERSATION_BOT_ACTIVE` | TB-002 |
| T02 | Dos tomas, un dueño | No existe | TB-002 |
| T03 | Inbound concurrente no manda TwiML tardío | No existe | TB-003 |
| T04 | Sin permiso → 403 y fila intacta | No existe | TB-007 + TB-002 |
| T05 | Transferencia auditada | No existe | TB-002b |
| T06 | Devolver al bot después de tomar usa reentrada | La reentrada sí tiene tests de return-to-bot. Falta el tramo de toma | TB-001 ya cubre el tramo de cierre; repetir entero en TB-002 |
| T07 | Mismo `MessageSid`, un efecto | Parcial: `webhook-events.service.test.js` y `webhook-acquire.integration.test.js` con monitoreo/SQL. No el controller con flag off | TB-006 |
| T08 | Crash entre acquire y commit, reclaim sin duplicar | Parcial en el repositorio de acquire. Falta el controller | TB-006 |
| T09 | `MONITORING_ENABLED=false` no apaga la idempotencia | No. El código hace lo contrario | TB-006 |
| T10 | Firma inválida en enforce, cero procesamiento | Parcial: middleware del **status**. Falta inbound | TB-005 |
| T11 | Keycap y sí/si equivalentes a la opción | Parcial: keycap en reentrada (`conversation-reentry-policy`), no en el motor | TB-010 |
| T12 | `inscripciones` no dispara `si` | No encontrado | TB-010 |
| T13 | Replay de ~80 mensajes | No hay fixture anonimizado en el repo | TB-009 / TB-010 cuando el equipo pegue el transcripto limpio |
| T14 | `fallback_global` repetido genera señal | No | TB-008 + TB-009 |
| T15 | Reinicio conserva dueño y handoff | Parcial: SQL guarda status. No hay test de proceso que mate `sessions.json` | TB-012 y una prueba de TB-002 |
| T16 | Sin WebSocket, el GET manda | Tests de frontend de live updates existen (`useConversationsLiveUpdates.test.ts`). Falta el caso takeover | TB-004 |
| T17 | Cierre `system` no es un WhatsApp nuevo | El código no llama a Twilio en el cierre. Falta assert de `transport=internal` | TB-014 |
| T18 | TwiML sin insert SQL queda contado | No | TB-014 / TB-015 |
| T19 | Fuera de 24 h | No hay envío proactivo | TB-018, no antes |
| T20 | Flag de toma apagado con humanos ya asignados | No | TB-002 |

## Qué ya tiene pruebas en el repo

Confirmado por presencia de archivos, no por una corrida de esta sesión:

- Reentrada: unidad e integración SQL (se saltea sola si no hay base o si falta `008`, según el encabezado del integration test).
- Lifecycle de vuelta al bot, con integración.
- Acquire concurrente de webhooks.
- Firma del callback de estado.
- Handoff y claim del inbox a nivel unidad (`human-handoff.service.test.js`, `conversation-inbox.service.test.js`), incluido el caso en que otro agente ya está asignado y el inbox compartido **permite** seguir. Ese test hay que invertirlo cuando TB-002b quite el robo por envío: el comportamiento esperado cambia a propósito.
- Motor de flujos, comandos globales, email, dedupe de archivo.
- Frontend: filtros, composer, timeline, permisos de ruta, monitoring display, live updates.

Conteo aproximado al auditar: del orden de 70 archivos de test en `whatsapp-bot` y del orden de 200 en `frontend`. No es un indicador de cobertura de los T01–T20.

## Cómo correr sin tocar producción

1. Una base `tea_bot_test` vacía, migraciones `001`–`008`, sin datos reales.
2. Variables de ese proceso apuntan solo ahí. No reutilizar el `.env` del `npm run dev` si ese entorno habla con una base compartida.
3. Twilio: no llamar a la red. Los tests de envío mockean `twilio-whatsapp.service`. El TwiML se asserta en el string de respuesta.
4. Integración de acquire: los tests ya borran por `provider_message_id` de prueba. Mantener ids con prefijo fijo y no apuntarlos a producción.

Cuando ese entorno exista, la corrida mínima de regresión de Fase 0 es:

```text
node --test \
  src/monitoring/webhook-events.service.test.js \
  src/monitoring/webhook-acquire.integration.test.js \
  src/middleware/verify-twilio-signature.test.js \
  src/services/conversation-reentry.service.test.js \
  src/services/conversation-reentry.integration.test.js
```

Más los tests nuevos del controller. No hace falta la suite entera para el gate de un PR, y sí hace falta en main antes de un release.

## Pirámide por fase

| Fase | Unit | Integración SQL | Manual |
|---|---|---|---|
| 0 | Gate de dedupe, firma, hash | Dos acquires, reclaim, reentrada ya existente | Un mensaje Twilio de prueba en staging con firma `log` |
| 1 | Servicio de toma con repo fake, composer | Dos transacciones de takeover, webhook simulado | Dos usuarios del panel y un inbound |
| 2 | Normalización y heurística de señales con fixtures | Insert de señal y dedupe | Replay anonimizado |
| 3 | Fragmento de búsqueda, MIME | `LIKE` sobre datos sembrados, descarga 404 cruzada | Una imagen real en sandbox |
| 4 | Clasificador de categorías de usage con JSON fixture | Rollup idempotente | Un mes de usage de solo lectura |
| 5 | Hidratación cuando el archivo falta | Reinicio lógico | Restart del proceso en TEST |
| 6 | Idempotencia de `clientRequestId` | No contra la cuenta real en CI | Un número interno |

## Datos que no entran a los tests

Teléfonos reales, cuerpos de alumnos, auth token, el export de octubre con PII. El caso de 80 mensajes se anonimiza antes de guardarlo como fixture: números reemplazados, nombre propio reemplazado, el texto de las opciones del menú puede quedar si es público del flujo.

## Qué no declarar

Una corrida local en verde no es producción validada. El ticket de release anota el entorno, la migración y el flag. TB-001 existe para eso.
