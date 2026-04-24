# Plan de implementación — Tea-bot

## Objetivo

Transformar el editor actual en un **constructor de conversaciones** con:

* vista principal basada en **Step Cards**
* complejidad progresiva en 3 niveles
* simulador simple
* flujo de publicación guiado
* “Más herramientas” para conexiones, historial y mapa avanzado

---

## Fase 0 — Preparación y alineación

**Objetivo:** dejar el terreno listo sin mezclar rediseño con cambios caóticos.

### Tareas

* Auditar la UI actual y mapear qué pantallas/componentes se reutilizan y cuáles se reemplazan.
* Definir el nuevo árbol de componentes.
* Congelar naming de producto en frontend:

  * flow → conversación / flujo según contexto
  * node → paso
  * transition → respuesta / qué pasa después
* Definir el contrato interno entre:

  * **modelo existente del motor**
  * **view model simple** para la nueva UI

### Entregable

* documento corto de arquitectura UI
* inventario de componentes actuales reutilizables / descartables
* mapping entre modelo técnico y modelo visual

---

## Fase 1 — Nuevo modelo de presentación

**Objetivo:** introducir la capa de UI nueva sin romper el motor actual.

### Tareas

* Crear adaptadores de frontend para convertir:

  * nodos + transiciones
  * en una lista ordenada de **Step Cards**
* Resolver cómo representar:

  * título legible del paso
  * mensaje del bot
  * respuestas del cliente
  * destino “Luego ir a”
* Definir reglas de inferencia iniciales:

  * primer paso = inicio
  * fallback visible como “En cualquier otro caso”
* Preparar estado local del editor para operar sobre el modelo simple y luego serializar al modelo técnico.

### Entregable

* parser técnico → view model simple
* serializer view model simple → técnico
* pruebas de ida y vuelta

### Criterio de éxito

* un flujo existente puede abrirse en la nueva estructura simple sin perder datos

---

## Fase 2 — Implementación de la vista principal

**Objetivo:** construir la nueva pantalla base del producto.

### Componentes

* `ConversationEditorPage`
* `StepsIndex`
* `StepCard`
* `ResponseRow`
* `DestinationSelector`
* `AddResponseMenu`

### Tareas

* Crear layout de columna única con índice lateral/drawer.
* Implementar `StepCard` según tu definición:

  * título editable
  * mensaje del bot
  * lista de respuestas
  * selector “Luego ir a”
  * menú kebab
* Implementar creación de paso y duplicación.
* Implementar crear destino nuevo desde el selector.
* Soportar reorder básico de pasos.
* Implementar estados vacíos y microcopys definidos.

### Entregable

* nueva vista principal funcional, sin simulador todavía

### Criterio de éxito

* usuario puede editar una conversación completa sin ver grafo ni JSON

---

## Fase 3 — Respuestas y lógica simple

**Objetivo:** hacer usable la creación de ramas sin exponer términos técnicos.

### Tareas

* Implementar `AddResponseMenu` con 3 opciones:

  * exactamente
  * cualquiera de estas
  * en cualquier otro caso
* Implementar edición inline de filas.
* Implementar chips/input para múltiples frases.
* Fijar visualmente fallback al final.
* Agregar ayuda contextual mínima bajo “Luego ir a”.
* Manejar loops y mostrar aviso ámbar.
* Garantizar que el usuario no vea:

  * match
  * priority
  * transition type

### Entregable

* edición completa de respuestas en vista simple

### Criterio de éxito

* el usuario puede modelar rutas simples sin entender conceptos del motor

---

## Fase 4 — Validaciones y errores en la vista simple

**Objetivo:** que el sistema prevenga errores antes de publicar.

### Tareas

* Validaciones inline en `StepCard`:

  * mensaje vacío
  * respuesta vacía
  * destino faltante
* Banner global para integridad del flujo.
* Modal “Falta completar” al guardar/publicar cuando aplique.
* Scroll automático al primer error.
* Mensajes en lenguaje de tarea, no técnico.

### Entregable

* sistema completo de errores de edición

### Criterio de éxito

* ningún error importante depende de entender la estructura técnica

---

## Fase 5 — Simulador simple

**Objetivo:** convertir la prueba en una experiencia entendible.

### Componentes

* `SimulatorPanel`
* `SimulatorChat`
* `SimulatorDetailsAccordion`

### Tareas

* Implementar simulador visible:

  * sticky en desktop
  * modal full-screen en mobile
* Mostrar solo chat por defecto.
* Agregar reinicio de prueba.
* Agregar detalles opcionales:

  * paso actual legible
  * tabla dato/valor
* Ocultar por defecto:

  * JSON
  * ids
  * estado interno crudo

### Entregable

* simulador de conversación usable desde la nueva vista

### Criterio de éxito

* probar el flujo se parece a hablar con el bot, no a depurar el motor

---

## Fase 6 — Guardado, dirty state y sincronización

**Objetivo:** robustecer la edición antes de tocar publicación.

### Tareas

* Integrar guardar con el modelo nuevo.
* Implementar:

  * cambios sin guardar
  * protección al salir
  * refresco tras save exitoso
* Resolver conflictos entre:

  * edición simple
  * representación técnica
* Asegurar sincronización estable al crear, mover, duplicar o borrar pasos.

### Entregable

* flujo de edición confiable de punta a punta

### Criterio de éxito

* no hay pérdida de datos ni inconsistencias entre UI y modelo persistido

---

## Fase 7 — Flujo de publicación

**Objetivo:** introducir el momento de mayor riesgo con UX fuerte.

### Componentes

* `PublishReviewModal`
* `PublishWarningsList`
* `PublishConfirmationStep`
* `RiskyPublishConfirmation`

### Tareas

* Botón “Poner en vivo”.
* Pantalla 1:

  * resumen de cambios
  * advertencias bloqueantes / no bloqueantes
* Pantalla 2:

  * confirmación con checkbox
* Pantalla 2b:

  * confirmación reforzada escribiendo “PUBLICAR”
* Toast/banner de éxito.
* Deshabilitar publicar cuando no corresponde.

### Entregable

* publish flow completo

### Criterio de éxito

* publicar deja de ser una acción ambigua o peligrosa

---

## Fase 8 — Más herramientas (Nivel 2)

**Objetivo:** agregar profundidad sin contaminar la experiencia principal.

### Componentes

* `MoreToolsPanel`
* `ConnectionsTable`
* `HistoryTimeline`

### Tareas

* Agregar toggle “Más herramientas”.
* Implementar subviews:

  * Conexiones
  * Historial
* Mostrar conexiones en tabla legible.
* Mostrar historial sin JSON por defecto.
* Implementar “Traer a mi borrador” con confirmación fuerte.
* Integrar filtros desde banners de error hacia conexiones.

### Entregable

* Nivel 2 funcional, sin mapa todavía

### Criterio de éxito

* el usuario puede resolver casos intermedios sin pasar al grafo

---

## Fase 9 — Mapa avanzado (Nivel 3)

**Objetivo:** conservar potencia sin que sea la interfaz principal.

### Tareas

* Mover el grafo a “Más herramientas → Mapa”.
* Mostrar modal de primera vez.
* Asegurar sincronización bidireccional:

  * editar en mapa actualiza Step Cards
  * editar Step Cards actualiza mapa
* Revisar si en primera iteración el mapa será:

  * solo visualización
  * o edición completa
* Mi recomendación: **primera iteración solo visualización + navegación**, y luego edición completa.

### Entregable

* mapa avanzado desacoplado de la vista principal

### Criterio de éxito

* el producto sigue siendo simple aunque mantenga potencia

---

## Fase 10 — Limpieza, migración visual y pulido

**Objetivo:** cerrar la transición y evitar doble paradigma.

### Tareas

* Remover o esconder accesos viejos que compitan con la nueva experiencia.
* Revisar textos, consistencia y estados vacíos.
* Ajustar responsive.
* Agregar analytics de uso:

  * cuántos usan simulador
  * cuántos abren Más herramientas
  * cuántos abren Mapa
  * errores frecuentes antes de publicar
* Pulir performance para flujos largos:

  * colapso de pasos
  * virtualización si hace falta

### Entregable

* experiencia final coherente

---

# Orden recomendado real de ejecución

Yo lo haría así:

## Sprint 1

* Fase 0
* Fase 1
* Fase 2

## Sprint 2

* Fase 3
* Fase 4

## Sprint 3

* Fase 5
* Fase 6

## Sprint 4

* Fase 7

## Sprint 5

* Fase 8

## Sprint 6

* Fase 9
* Fase 10

---

# Prioridad de negocio

## Lo imprescindible para salir con valor

* vista principal nueva
* respuestas simples
* validaciones
* simulador
* publicación guiada

## Lo importante pero no bloqueante

* conexiones
* historial mejorado

## Lo post-lanzamiento o segunda ola

* mapa avanzado editable
* optimizaciones para flujos muy largos

---

# Riesgos a controlar

## 1. Doble verdad entre UI simple y modelo técnico

Mitigación:

* adaptar y serializar desde una sola capa intermedia

## 2. Flujos existentes con estructuras raras

Mitigación:

* fallback de compatibilidad
* warnings cuando un flujo no pueda representarse perfecto en vista simple

## 3. Complejidad excesiva en flows grandes

Mitigación:

* índice lateral
* colapso de pasos
* filtro por título

## 4. Publicación confusa

Mitigación:

* resumen claro
* confirmación fuerte
* diferenciación entre bloqueante y no bloqueante

---

# Definición de Done por fase

Una fase está terminada cuando cumple estas 4 cosas:

* funciona en desktop y mobile razonablemente
* no expone terminología técnica innecesaria
* mantiene compatibilidad con el modelo actual
* tiene al menos pruebas básicas de interacción y persistencia

---

# Recomendación final

No arrancaría por “Más herramientas” ni por el mapa.

Arrancaría por este núcleo:

1. `StepCard`
2. `ResponseRow`
3. `DestinationSelector`
4. validaciones inline
5. simulador simple
6. publish flow

Ese núcleo ya convierte Tea-bot en otro producto.

---

# Estado de implementación (seguimiento)

## Completado

* **Fase 1 (modelo de presentación):** `conversationViewModel.ts`, `conversationAdapters.ts`, `conversationValidation.ts` (stub), tests Vitest en `conversationAdapters.test.ts`, script `npm run test`.
* **Fase 2 (shell del editor):** `ConversationEditorPage` en ruta `/flows/:flowId/conversation`, `StepsIndex`, simulador, publicación guiada.
* **Nivel 2 — Más herramientas:** `Drawer` lateral desde un único botón; pestañas **Conexiones** (`ConnectionsTable` + `connectionRows.ts`), **Historial** (`HistoryTimeline` + APIs existentes de versiones), **Mapa** como única puerta al grafo en esta pantalla.
* **Historial → borrador:** `RestoreDraftDialog` + `useConversationHistory`; confirmación fuerte; `overwriteDraft: true`; refresco vía `fetchQuery` + `hydrateFromServer` tras éxito.
* **Nivel 3 — Mapa:** `AdvancedMapIntroDialog` (primera vez, `localStorage`), `AdvancedMapView` con `FlowGraphCanvas` **`readOnly`** (mapa solo visualización; sin edición ni segunda fuente de verdad).
* **Editor único:** eliminación de `FlowEditorPage` y paneles solo-clásicos; **`/flows/:flowId`** redirige a **`/flows/:flowId/conversation`**. Listado: un solo botón **Editar** a conversación; flujos nuevos abren en conversación.
* **Paridad pre-eliminación:** **Datos** (nombre/descripción) y **Validar** (API servidor) en `ConversationEditorPage`; historial sin JSON por defecto (decisión explícita).
* **Flujos grandes:** búsqueda en `StepsIndex` y en el índice móvil si hay más de 6 pasos.
* **Documentación:** `docs/EDITOR_ARCHITECTURE.md` (arquitectura nivel 2/3 y mapa).
* **Tests:** `connectionRows.test.ts`, `RestoreDraftDialog.test.tsx`, `MoreToolsPanel.test.tsx`.
* **Tipo `FlowNode.ui.stepTitle`** para títulos legibles en round-trip.

## Pendiente (orden del plan)

* Mapa **editable** con sync correcto con el view model (opcional; hoy solo lectura).
* Resto de fases del documento (optimizaciones adicionales, etc.) según prioridad.