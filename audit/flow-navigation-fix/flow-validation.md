# Validación del flujo

Documento usado: `main-menu.json`, producción `v62`. No se escribió en `dbo.flow_versions` ni en `dbo.flow_version_snapshots`. El publicado local sigue siendo v24.

## Opción 3️⃣ Dirección de estudios

Nodo `si_pd_menu`.

- Identificador visible: número 3, etiqueta `Dirección de estudios`.
- Valor de la transición `match`: `"3"`.
- Destino: `si_pd_direccion`. El nodo existe.
- Alias publicado: `matchIncludes` `"direccion"`. No había alias de la etiqueta completa.
- El destino muestra el mail académico y el interno 134, y después ofrece volver, cerrar o pedir una persona. Su `default` va a `fallback_global`, no a otro handoff.
- No se crea un handoff al elegir la opción 3. El handoff aparece solo con la opción 3 de esa pantalla siguiente, o con el comando `humano`.

El mismo patrón numérico existe en `si_pg_menu`, sin los `matchIncludes` de Periodismo Deportivo. La etiqueta visible también selecciona allí, sin editar ese programa.

## Motor

`normalizeFlowMatchText` es la única forma canónica. La usan el compile y las dos evaluaciones del motor. El texto persistido del usuario no se reescribe, salvo la captura, que guarda el texto recortado.

`buildNodeTransitionIndex` arma exactos, ambiguos, includes y etiquetas. `resolveIndexedTransition` elige. El compile guarda ese índice en `transitionIndexByNodeId`.

Si el menú numerado se queda en el mismo nodo, `formatUnmatchedMenuReply` antepone la explicación y `unmatchedOptionCount` sube. Al salir del nodo, el contador se borra.

## Pruebas

Unidad contra v62: las siete formas de `Dirección de estudios` y el número terminan en `si_pd_direccion`. Las otras opciones probadas conservan su destino. Dos preguntas libres dejan `si_pd_menu`, con respuestas distintas y sin mencionar la fecha. `Menú` con email abre `welcome`. Sin email abre `collect_email`. `Atrás` recorre el historial. La captura guarda `María Pérez`.

SQL, conversaciones creadas y borradas por el test:

- `current_node_key=si_pd_direccion`, `current_flow_id=main-menu`, `current_flow_version=v62` después de la etiqueta.
- Dos preguntas libres persisten `si_pd_menu` y `unmatchedOptionCount=2`.
- `Menú` persiste `welcome`. `Atrás` persiste `si_pd_menu`.
- `assigned` más `Menú`: `skipFlowEngine`, el nodo sigue en `si_pd_menu`.
- Reentrada `pending`: `Dirección de estudios` solo presenta la pregunta de continuar o empezar. `3` en `awaiting_choice` repregunta. No abre `si_pd_direccion`.
- Dos ingresos con el mismo MessageSid: un outbound, la segunda respuesta es replay, el nodo queda en `si_pd_direccion`.

Suite completa: 426 aprobadas, 0 fallas, 2 omitidas por la migración 009.

## Regresiones y riesgos

`sí` y `si` que iban al mismo destino siguen yendo. Si normalizan igual y el destino difiere, ahora se quedan. Un `matchIncludes` corto, de menos de 3 caracteres, deja de disparar; en v62 no hay needles de ese largo. `inscripciones` ya no puede caer por el substring `si`.

Una frase que contiene dos needles de destinos distintos ya no toma el primero. La etiqueta completa del mensaje sigue ganando.

`Atrás` sin historial en v62 abre `collect_email`, que es la entrada, aunque la persona ya tenga email. El mensaje siguiente, si el email está guardado, no se trata como captura de correo. No se cambió esa regla.

Los menús cuyo `default` apunta a sí mismos ahora agregan una explicación. Los nodos sin lista numerada no. `human_handoff` sigue reenviando su propio texto si el motor llegara a ejecutarse; con estado `assigned` o `waiting_human` el motor no corre.

## Publicación

No hace falta publicar un flujo nuevo para este defecto. v62 ya tiene la etiqueta y el destino. Hay que desplegar el motor junto con TB-005 y TB-006. El snapshot histórico local no se reemplazó.
