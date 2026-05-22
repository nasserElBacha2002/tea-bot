# DoD — Mapa de lectura: vista mensaje primero

**Fecha:** 2026-05-22  
**Estado:** `FLOW_MAP_MESSAGE_FIRST_VIEW_READY`

---

## Problema detectado

El mapa mostraba demasiada información técnica por nodo (tipo, id, chips, mensaje truncado a 2 líneas / 48 caracteres). En flujos grandes (`main-menu`) las tarjetas se superponían y el usuario no podía leer qué mensaje ve el cliente ni qué opciones tiene.

---

## Nuevo enfoque

El mapa es una **lectura resumida del recorrido**, no un editor ni un JSON visual.

Cada tarjeta responde:

1. ¿Qué mensaje ve el usuario?
2. ¿Qué opciones / salidas tiene?
3. ¿A dónde puede ir?

---

## Vista mensaje (por defecto)

Al abrir el mapa:

- Selector **Vista mensaje** activo.
- Profundidad **2 saltos**.
- Centrado en nodo seleccionado / `entryNode`.

Tarjeta (≈300×220px máx.):

| Zona | Contenido |
|------|-----------|
| Título | `stepTitle` o id humanizado (no id técnico como título principal) |
| Cuerpo | 3–5 líneas del mensaje del bot (markdown suavizado, truncado) |
| Salidas | `N respuestas → Destino` agrupadas por `nextNode` |
| Footer | Cantidad de salidas, cierre, avisos de validación |

**Oculto en tarjeta:** id largo, tipo de nodo, chips de color, metadata, coordenadas.

---

## Vista técnica

Toggle **Vista técnica** en la toolbar del mapa:

- Muestra id, tipo, transiciones crudas (`type → nextNode`).
- Mensaje más largo pero aún acotado en altura.

---

## Detalle completo

Panel lateral `MapNodeDetailPanel` (320px):

- Nombre, id, tipo.
- Mensaje completo.
- Lista de transiciones con tipo, valor y destino.
- Errores de validación locales.

Se actualiza al hacer clic en un nodo del mapa (y al buscar / centrar).

---

## Conexiones (aristas)

Etiquetas agrupadas vía `formatTransitionSummaryForEdge`:

- Una respuesta: valor corto → destino.
- Varias: `6 respuestas → Welcome`.
- Default: `Por defecto → …`.

Detalle de sinónimos en tooltip, no sobre la línea.

---

## Helpers (`flowMapDisplay.ts`)

- `getNodeDisplayTitle`
- `getNodeMessagePreview`
- `prepareMessageForPreview`
- `groupTransitionsByTarget`
- `formatTransitionSummary` / `formatTransitionSummaryForEdge`
- `getNodeFooterHints`

---

## Archivos tocados

- `frontend/src/features/flows/utils/flowMapDisplay.ts`
- `frontend/src/features/flows/components/FlowGraphNode.tsx`
- `frontend/src/features/flows/utils/flowGraph.mapper.ts`
- `frontend/src/features/flows/components/FlowGraphCanvas.tsx`
- `frontend/src/features/flows/editor/components/AdvancedMapView.tsx`
- `frontend/src/features/flows/editor/components/MapNodeDetailPanel.tsx`

**Sin cambios** en backend ni persistencia DB.

---

## Tests

```bash
cd frontend && npm test
```

- `flowMapDisplay.test.ts` — helpers y agrupación.
- `flowMapSubgraph.test.ts` — profundidad, búsqueda, resumen de aristas.

---

## Validación manual (checklist)

1. Editor → mapa de `main-menu`.
2. Vista mensaje por defecto.
3. Nodo actual legible sin zoom extremo.
4. Mensaje del bot es el contenido dominante.
5. No hay ids largos como título principal.
6. Transiciones resumidas (`N respuestas → …`).
7. Clic en nodo → panel lateral con detalle.
8. Vista técnica → ids y tipos visibles.

---

## Limitaciones pendientes

- Layout jerárquico automático (dagre) no integrado; posiciones siguen en `ui.position`.
- «Ver flujo completo» puede seguir siendo denso en flujos muy grandes.
- Panel de detalle en móvil ocupa franja inferior (altura limitada); el detalle completo es más cómodo en desktop.
