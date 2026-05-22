# DoD — Simplificación UX editor de flujos

**Fecha:** 2026-05-22  
**Estados:** `FLOW_EDITOR_ACTIONS_SIMPLIFIED` · `FLOW_MAP_READABILITY_IMPROVED`

---

## Barra de acciones (desktop)

Orden final:

1. **Guardar cambios** (primaria, `contained`)
2. **Probar conversación**
3. **Poner en vivo**
4. **Descargar JSON**
5. **Importar JSON**
6. **Más herramientas** (al final)

En pantallas angostas, Descargar/Importar JSON pasan al drawer **Más herramientas**.

---

## Botón «Datos»

- Eliminado de la barra principal.
- Reemplazado por **Ver datos técnicos** dentro de Más herramientas (abre el mismo `FlowMetadataDialog`).

---

## Guardar cambios = validar + guardar

Flujo al clic:

1. Validación local (`conversationValidation`).
2. Si falla → mensaje *No se pudo guardar porque el flujo tiene errores de validación* y no persiste.
3. `POST /api/flows/validate` con el borrador.
4. Si el servidor rechaza → error claro, sin guardar.
5. `PUT /api/flows/:id` si todo es válido → *Cambios guardados correctamente*.

Estados del botón: **Validando…** / **Guardando…**

---

## Validar

- Ya no aparece como botón principal.
- **Validar sin guardar** en Más herramientas (misma lógica anterior de `handleValidate`).

---

## Más herramientas

Contenido secundario:

- Validar sin guardar
- Ver datos técnicos
- Ver mapa / Abrir mapa
- Conexiones, Historial (tabs)
- En móvil: Descargar JSON, Importar JSON

---

## Mapa de lectura

Mejoras en `AdvancedMapView` + `FlowGraphCanvas` (`mapViewMode`):

| Mejora | Detalle |
|--------|---------|
| Zoom inicial | Centra en nodo seleccionado / `entryNode`, no `fitView` global |
| Profundidad | 1 / 2 / 3 saltos / Todo (default **2 saltos**) |
| Búsqueda | Por id, nombre o mensaje |
| Nodos compactos | Título, tipo, mensaje truncado, conteo de respuestas |
| Aristas | Etiquetas resumidas (*N respuestas → destino*) con tooltip |
| Leyenda | Colores por tipo de paso |
| Sincronización | Clic en nodo → selecciona paso en editor y cierra mapa |
| Layout | Modal fullscreen, toolbar fija |

Helpers: `frontend/src/features/flows/utils/flowMapSubgraph.ts`

---

## Limitaciones pendientes

- Layout automático jerárquico (dagre) no integrado; posiciones siguen viniendo de `ui.position` en DB.
- «Ver flujo completo» sigue pudiendo ser denso en flujos muy grandes (opt-in).
- Importar JSON en historial (tab Historial) mantiene copy anterior parcial.

---

## Tests

```bash
cd frontend && npm test
cd whatsapp-bot && npm test
```

Frontend:

- `conversationSaveFlow.test.ts`
- `flowMapSubgraph.test.ts`
- `ConversationEditorPage.test.tsx` (actualizado)
- `ConversationEditorPage.toolbar.test.tsx` (nuevo)

`npm run lint` / `npm run build` en frontend: ejecutar localmente (pueden existir errores previos en `conversations/`).

---

## Backend

Sin cambios en esta fase (solo UX frontend).
