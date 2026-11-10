# Concurrencia en dos procesos

No se usó producción. Los procesos usaron la base local `tea-bot` (`TB_SQL_TEST_CONFIRM=tea-bot`).

Un administrador (`dist-ana`) y un operador (`dist-luis`) corrieron en dos `node` independientes y tomaron la misma conversación `bot`. Los UUID eran distintos. Si coincidieran, la prueba falla.

Resultado: pass, no skipped.

- Una toma aceptada y la otra `CONVERSATION_OWNED`.
- La fila quedó `assigned` al ganador.
- Un solo handoff activo.
- Un solo mensaje de sistema de toma.
- El proceso ganador publicó un `conversation.assigned`. El perdedor no.
- Otro proceso del ganador persistió la respuesta. El del perdedor recibió `CONVERSATION_OWNED`. Quedó un solo mensaje de agente.
- El proceso del ganador devolvió la conversación al bot. Estado `bot`, sin agente, sin handoff activo, `reentry_json.status = pending`.
