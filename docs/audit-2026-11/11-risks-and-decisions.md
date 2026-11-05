# Riesgos y decisiones

## P0 confirmados por código

| # | Riesgo | Consecuencia | Acción |
|---|---|---|---|
| 1 | Inbound Twilio sin firma | Un tercero que llegue al puerto puede inyectar mensajes y disparar el motor | TB-005, primero `log` |
| 2 | Dedupe de archivo antes del éxito, y SQL solo si el monitoreo está on | El reintento de Twilio no vuelve a correr el flujo; el usuario recibe el TwiML genérico de error | TB-006 |
| 3 | No se puede tomar una conversación `bot` | Un bucle de menú sigue hasta que el flujo derive solo | TB-002 y TB-004, después del lock |
| 4 | Claim sin `UPDLOCK` y TwiML sin relectura de estado | Dos agentes quedan como dueños; un turno ya empezado puede responder después de una toma | TB-003 antes de encender el flag |
| 5 | SHA-256 sin salt | Filtración de la variable de entorno permite probar el hash offline a alta velocidad | TB-007 |
| 6 | `POST /webhook` Meta sin firma | Misma clase de inyección si la ruta es pública | META-01 |
| 7 | Sin CI | Estos cambios pueden mergearse sin T07–T10 | Pipeline mínimo en el primer PR de Fase 0: test de backend del PR y typecheck del frontend. No es un ticket de producto, es el gate de TB-006 |

## P1

| Riesgo | Notas |
|---|---|
| Falsos positivos de bucles | Por eso shadow antes de alert, y nada de handoff automático |
| `safe` matching cambia un flujo que dependía de substring | Flag `legacy` y replay |
| Sesión JSON distinta de SQL después de un restart | Fase 5, no bloquear la toma: el status `assigned` en SQL ya corta el motor al **siguiente** mensaje |
| Contabilidad TwiML sin SID | No cerrar la brecha de 1.024 en un slide. TB-015 la muestra |
| PII en logs (`From`) y, a futuro, en señales o en queries de búsqueda | Sacar el log en el PR de TB-006. No guardar el cuerpo en `conversation_attention_signals`. No loguear `q` |
| `ALLOW_DEV_SEED=true` en Compose | P1 si ese archivo se usa para producción. Confirmar el método de deploy real antes de tratarlo como incidente |
| Readiness miente | `/health` 200 con SQL caído. TB-013 |
| Token de sesión sin rol entra como admin | TB-007 PR2 |

## Decisiones ya tomadas en esta auditoría

1. No reescribir el sistema ni partirlo en servicios.
2. No reimplementar la reentrada. TB-001 valida.
3. No agregar `BOT_ACTIVE` / `HUMAN_ACTIVE` como status SQL. Se usan `bot`, `waiting_human`, `assigned`. La reentrada vive en `reentry_json`.
4. `close` y `return-to-bot` siguen siendo la misma operación hasta que producto pida un cierre sin bot. No se diseña un tercer estado en la Fase 1.
5. La toma limpia `reentry_json` pendiente en la misma transacción, porque el skip por `assigned` debe ser la única política y el prompt no debe quedar armado para el próximo return mal entendido.
6. La búsqueda se apoya en el `LIKE` actual. FULLTEXT solo con una medición.
7. Los binarios no van a SQL. Tampoco a un bucket público.
8. El cargo Meta no se reparte por conversación.
9. `MONITORING_ENABLED` deja de ser la llave de la correctitud. Sigue siendo la llave de jobs de salud.
10. La detección de atasco no crea handoffs en las primeras dos fases (`off`, `shadow`, `alert`).

## Decisiones que el equipo de producto todavía tiene que cerrar

No bloquean TB-006 ni TB-005. Sí bloquean el copy y el permiso fino de la Fase 1:

| Decisión | Default propuesto si nadie responde | Efecto si se elige otro |
|---|---|---|
| ¿Quién puede tomar? | Admin y operador de conversaciones | Hay que sacar el permiso del rol operador |
| ¿Un admin puede quitarle el hilo a otro? | Sí, con motivo, permiso distinto | Si no, TB-002b no se construye y el 409 es el final |
| ¿La toma exige motivo? | No. La reasignación sí | Campo obligatorio en el POST de toma |
| ¿Cerrar significa devolver al bot o archivar? | Seguir devolviendo al bot, un solo botón | Hace falta un status `closed` real y sacar el alias |
| ¿Alertas con sonido? | No. Badge | Reusar el sonido de handoff |
| ¿Foto en modo bot responde menú? | No. Se guarda y no corre el motor | Hay que definir el copy automático |

## Hipótesis que no se promovieron a hallazgo

- Que los 1.024 salientes sean el TwiML de error. Es plausible por el `catch` del controller. No está medido.
- Que octubre siga igual en la cuenta de Twilio. No se volvió a consultar.
- Que `MONITORING_ENABLED` esté en false en producción. El default de código es false; el example lo documenta true. **Pendiente de validación.**
- Que la migración `008` no esté aplicada en producción. El código la espera y degrada si falta. **Pendiente de validación.**
- Que el flujo publicado dispare `si` dentro de `inscripciones`. El motor **puede** hacerlo. Hace falta el documento publicado para afirmar que pasa.
- Que el volumen de mensajes haga lento el `LIKE`. Con miles de filas por mes, es poco probable. Medir antes de FULLTEXT.

## Residual aceptado de la toma

Un TwiML que Twilio ya recibió no se puede retirar. La garantía implementable es no **iniciar** la construcción de una respuesta automática después del commit. Hay que decirlo en la nota de release para que operaciones no espere borrado de un mensaje ya salido.

## Qué no hacer

- Microservicios, Kafka, Redis, CQRS, Event Sourcing, un modelo de LLM para «entender» el menú.
- Fuzzy matching libre.
- Handoff automático masivo por señales no calibradas.
- Hardcodear USD 0,01925 o USD 0,005 como tarifa vigente.
- Contar `system` o una recarga dentro del gasto de mensajería.
- Declarar la reentrada o el inbox «validados en producción» por los tests que están en el disco.
- Aplicar migraciones nuevas o cambiar flags productivos como parte de esta auditoría. No se hizo.

## Seguimiento mínimo después del primer deploy de Fase 0

- Inbound recibido, procesado, fallido (ya hay `activity-store` si el monitoreo corre; si no, el log estructurado del controller).
- Cantidad de SID reclamados por lease vencido.
- Mismatches de firma en modo `log`.
- Errores `ConversationDB` en outbound.

Esos cuatro números dicen si TB-006 y TB-005 se pueden endurecer. No hace falta el dashboard de costos para leerlos.
