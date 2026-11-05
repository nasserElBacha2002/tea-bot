# Roadmap de implementación

El orden del plan v1.1 se mantiene, con un cambio explícito: la activación de la toma humana no entra a producción antes de la exclusión SQL del inbound. El diseño de la toma puede escribirse en paralelo. La reentrada no se vuelve a programar.

Ninguna fase termina porque compile. Cada una exige tests del ticket, prueba en SQL TEST cuando toca base, flag apagado en el deploy y rollback escrito.

## Dependencias

```text
TB-001 validar reentrada (no reescribir)
    \
     +--> TB-019 toma  (necesita lock de TB-003)
TB-006 idempotencia always-on  ----+
TB-005 firma inbound          -----+--> activar TB-019 en producción
TB-007 hash y permiso takeover ----+

TB-008 instrumentar transiciones --> TB-009 alertas
TB-010 matching (flag) --> TB-011 lint puede ir en paralelo
TB-009 usa el botón de TB-019, no lo reemplaza

TB-022 búsqueda UX  (independiente)
TB-020 recibir media --> TB-021 enviar media

TB-014 transporte --> TB-015 conciliación --> TB-023 panel mensual
                                      \----> TB-024 costos
TB-006 y TB-014 no se bloquean entre sí

TB-012 sesiones SQL después de TB-006 y TB-019
TB-013 readiness en cualquier momento después de TB-006
TB-018 plantillas al final, si hay demanda
```

## Fase 0 — Correctness y seguridad crítica

**Tickets:** TB-006, TB-005, TB-007 (hash y permiso, sin la UI de toma), TB-001 como checklist de staging, inicio de TB-003 (columna `status_version` y relectura antes del TwiML, todavía sin botón).

**Por qué primero:** un reintento ya puede tragarse la respuesta real. Una firma ausente permite inyectar mensajes. La toma, si se enciende antes, escribe estado que el webhook puede pisar con un TwiML.

**Entregable:** inbound idempotente con la base aunque `MONITORING_ENABLED=false`; firma en `log` medible; contraseñas nuevas con salt en el siguiente login; versión de estado que el pipeline consulta antes de responder.

**Gate:** T07, T08, T09, T10 en SQL TEST. Un reintento del mismo `MessageSid` no duplica outbound. Un crash entre acquire y commit se puede reclamar. Firma inválida en `enforce` no persiste. `MONITORING_ENABLED=false` no desactiva el acquire.

**Rollback:** `TWILIO_SIGNATURE_MODE=log` si `enforce` rechaza tráfico bueno. El acquire SQL no se apaga con el flag de monitoreo; el rollback de código vuelve al comportamiento anterior solo con revert del deploy, no con un drop de `provider_webhook_events`.

**Paralelo permitido:** TB-005 y TB-006 en ramas distintas. TB-001 es prueba, no rama de feature.

## Fase 1 — Atención humana

**Tickets:** TB-002, TB-003 completo, TB-004, TB-019 como el conjunto. TB-007 permiso `conversation.takeover` y `conversation.reassign`.

**Entregable:** botón en `bot` y en cola, un solo dueño, sin respuesta automática iniciada después del commit, vuelta al bot por la reentrada existente.

**Gate:** T01–T06, T15, T16, T20. Dos navegadores. Webhook concurrente. Agente sin permiso no escribe.

**Dependencia dura:** Fase 0 desplegada o, como mínimo, TB-003 y TB-006 en el mismo release que el botón. No activar `MANUAL_TAKEOVER_ENABLED` en el mismo instante que se estrena `enforce` de firma si eso impide ver logs; pueden compartir release con flags independientes.

**Rollback:** flag en false. Conversaciones ya `assigned` se siguen atendiendo. No hay drop de `status_version`.

## Fase 2 — Navegación y recuperación

**Tickets:** TB-008, TB-009, TB-010, TB-011. TB-016 queda P2 al final de la fase si las métricas muestran el problema de `collect_email`.

**Entregable:** razones de transición en shadow; señales visibles solo cuando el modo pasa a `alert`; normalización detrás de flag; lint de publicación en advertencia.

**Gate:** T11–T14. Shadow no cambia textos. El caso de 80 mensajes, cuando exista el fixture anonimizado, o avanza o señala. `inscripciones` no dispara `si`.

**Dependencia:** TB-019 para la acción «Tomar». La detección puede medirse antes en shadow.

**Rollback:** `FLOW_MATCH_NORMALIZATION=legacy`, `STALL_DETECTION_MODE=off`.

## Fase 3 — Búsqueda y multimedia

**Tickets:** TB-022 primero (el SQL ya busca). TB-020 después. TB-021 al final de la fase.

**Entregable:** resultados con fragmento y salto al mensaje. Fotos y PDF entrantes visibles con sesión. Envío de adjuntos solo si hay URL temporal que Twilio alcance.

**Gate:** pruebas de `05-media-and-search.md`. Búsqueda y media no comparten release obligatorio.

**Rollback:** ocultar el control de archivo. Las filas de attachment ya guardadas se siguen sirviendo o se dejan inaccesibles por flag de lectura, sin borrar el disco en el rollback del código.

## Fase 4 — Monitoreo y costos

**Tickets:** TB-014, TB-013 si no entró en Fase 0, TB-015, TB-023, TB-024.

**Entregable:** transporte en mensajes nuevos, rollup diario, usage records, panel mensual con las tres clases de cifra (confirmado, estimado, pendiente) y CSV.

**Gate:** un mes ya cerrado reconstruido contra usage, con la diferencia visible. `system` fuera del facturable. Recarga fuera del consumo. T18: fallo de persistencia contado, no escondido.

**Dependencia:** TB-014 antes de declarar la brecha de 1.024 explicada. Se puede mostrar usage del proveedor antes de tener transporte histórico; esos meses quedan «estimado / sin transporte».

## Fase 5 — Persistencia y mantenibilidad

**Tickets:** TB-012, TB-017 acotado a lo que las fases anteriores hayan dejado mezclado, higiene de logs de teléfono.

**Entregable:** el motor no depende de `sessions.json` como autoridad. Dual-read solo durante el corte. `/readyz` con base y flujo si TB-013 no se hizo.

**Gate:** reinicio de proceso conserva nodo y dueño humano. Dos inbound concurrentes en dos procesos no duplican efectos (esto ya debería estar por TB-006; se re-chequea).

**Rollback:** seguir escribiendo JSON en paralelo hasta el corte. Después del corte, el rollback de código debe seguir leyendo SQL, no volver a creer el archivo viejo.

## Fase 6 — Plantillas proactivas

**Ticket:** TB-018.

**Condición de entrada:** firma en enforce, idempotencia always-on, costos medibles, y un pedido operativo concreto de hablarle a alguien fuera de la ventana de 24 h. Sin eso, no se empieza.

**Entregable:** catálogo de templates aprobados en Twilio, envío con `clientRequestId`, status callback, sin campañas masivas ni editor de templates.

## Qué puede ir en paralelo sin pisarse

| Hilo | Tickets | No mezclar con |
|---|---|---|
| Integridad | TB-006, TB-005, TB-007 hash | Activación del botón |
| Toma | TB-002, TB-003, TB-004 | Cambios de matching |
| Búsqueda | TB-022 | — |
| Costos, medición | TB-014, cliente de usage en solo lectura | Cambiar el matcher el mismo día del informe |
| Reentrada | Ejecutar tests en TEST y anotar el flag real | Cualquier rewrite de `conversation-reentry.service.js` |

## Definición de terminado, todas las fases

- Diff revisable por ticket.
- Tests unitarios del módulo y, si hay SQL, integración en TEST.
- Permisos comprobados con 401 y 403.
- Flag y rollback probados, no solo descriptos.
- Sin declaración de «validado en producción» por una corrida local.
- Documentación de API en el PR del endpoint, corta, junto al router.

## Secuencia de las primeras dos semanas

1. Confirmar en staging, sin código nuevo: migración `008` aplicada, `REENTRY_POLICY`, y una conversación de prueba que al cerrarse no cae en fallback. Anotar el resultado en el ticket TB-001.
2. TB-006 en rama propia.
3. TB-005 en `log` en la misma semana, sin `enforce`.
4. Recién con TB-006 mergeado, PR de `status_version` + barrera de TwiML + takeover apagado por flag.
5. UI y permiso. Canary con un agente. Después el resto.
