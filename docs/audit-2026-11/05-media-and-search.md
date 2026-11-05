# Multimedia y búsqueda

## Multimedia — estado

| Capacidad | Estado | Evidencia |
|---|---|---|
| Inbound con texto | Mensaje SQL `body` | `persistInboundMessage` |
| Inbound solo imagen o documento | Se descarta | `twilio-webhook.controller.js` líneas 97–105, `!event.text` |
| Metadata de media | No modelada | `001` no tiene tabla de adjuntos. El raw del webhook puede quedar en `raw_payload_json` solo si hubo texto |
| URL de Twilio persistida como link público | No | Tampoco hay descarga al storage |
| Envío de agente con archivo | No | REST solo `Body` |
| Preview en timeline | No | El timeline muestra texto |
| Retención de binarios | No aplica | La retención actual borra conversaciones SQL, no archivos |

Un WhatsApp con foto y caption vacío no entra a la conversación. Un WhatsApp con caption y foto guarda el caption y pierde el archivo en cuanto Twilio invalida `MediaUrl`.

## Diseño de recepción

No guardar el binario en SQL Server.

Tabla propuesta `conversation_message_attachments`:

- `id`, `message_id`, `conversation_id`
- `ordinal`
- `provider_media_sid` o índice Twilio
- `mime_type`, `byte_size`, `original_name` saneado
- `storage_key` opaco
- `status`: `pending`, `stored`, `failed`, `expired`
- `sha256`
- sin URL permanente de Twilio

Flujo:

1. El adapter lee `NumMedia`, `MediaUrl{n}`, `MediaContentType{n}`.
2. Si no hay texto y hay media, igual se persiste el mensaje inbound (`body` vacío) y se sigue el ciclo de la conversación. Un adjunto en modo humano no dispara el motor. Un adjunto en modo bot puede contarse como entrada no reconocida; no inventar un nodo de «recibí tu archivo» hasta tener copy de producto. Mientras tanto, el bot sigue su matching sobre body vacío y caerá en default: por eso la primera entrega persiste el archivo y, si el status es `bot`, responde con el mismo fallback que un texto vacío **solo si** hoy un texto vacío ya tiene comportamiento. Hoy el texto vacío ni siquiera entra. Decisión recomendada: persistir media, no correr el motor con string vacío, y no mandar menú automático por una foto. El agente la ve. Si el bot debía seguir, el usuario escribe texto. Esto evita un menú sorpresa por cada captura.
3. Descarga server-side con el auth de Twilio, timeout, tope de tamaño y allowlist MIME. Error de descarga marca `failed` y no tumba el resto del webhook.
4. Disco privado fuera del web root, o el volumen ya montado `whatsapp-bot/data` en un subdirectorio no servido por Express. Clave aleatoria, no el nombre del usuario.
5. `GET /api/conversations/:id/attachments/:attachmentId` con `requireAuth`, comprobando que el attachment pertenece a esa conversación. Stream del archivo. `Content-Disposition` con nombre saneado. Cache privado, no público.
6. Retención: al borrar la conversación, borrar objetos. La retención SQL ya existe; el ticket engancha el archivo ahí.

Allowlist inicial: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Rechazar el resto con `failed` y razón `mime_not_allowed`. Tamaño inicial propuesto 16 MB, por debajo de los límites habituales de WhatsApp y sujeto a la documentación vigente de Twilio al implementar. No copiar un límite de memoria de oídas en el código sin citar la doc en el PR.

Defensa: no ejecutar, no servir como `text/html`, forzar `nosniff`, nombre sin path separators. El PDF no se renderiza en un visor que ejecute JavaScript embebido si el visor del navegador lo abre inline; preferir descarga para PDF y preview solo de imágenes.

Mensajes viejos sin fila de attachment siguen siendo texto. No backfill: las URL de Twilio ya vencieron.

## Diseño de envío

Después de que recibir y ver funcione.

1. Permiso de operador y conversación `assigned` al actor, o takeover previo. No enviar archivo en `bot`.
2. Validar MIME, extensión coherente y tamaño antes de guardar.
3. Guardar en el mismo storage privado.
4. Twilio tiene que poder leer el binario. Una URL pública permanente no sirve. Opciones, en orden:
   - URL temporal firmada de un solo uso, HTTPS, vencimiento corto, sin listado del directorio. Twilio la fetchéa al enviar.
   - Si la red de producción no puede exponer ni una URL temporal, el envío queda bloqueado hasta tener ese endpoint. No subir a un bucket público para salir del paso.
5. REST con `MediaUrl` y `Body` opcional. `clientRequestId` único para no duplicar si el panel reintenta.
6. Persistir SID, `sender_type = agent`, attachment `status = sent|failed`. El error de Twilio se muestra en el composer.
7. Ventana de 24 horas: si Twilio rechaza por policy, guardar el fallo y no reintentar en loop. Plantilla oficial no entra en este ticket (TB-018).

## Búsqueda — estado

El backend ya busca dentro de los mensajes.

```253:264:whatsapp-bot/src/repositories/conversation.repository.js
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      clauses.push(`(
        c.phone_number LIKE $${i}
        OR c.display_name LIKE $${i}
        OR EXISTS (
          SELECT 1 FROM dbo.conversation_messages m
          WHERE m.conversation_id = c.id AND m.body LIKE $${i}
        )
      )`);
```

Eso devuelve conversaciones, no mensajes. No hay snippet, no hay salto, no filtra emisor ni fecha, no distingue teléfono de contenido. El input dice «Teléfono o nombre». `contact_email` no entra en el `LIKE`.

`LIKE '%texto%'` no usa un índice B-tree de forma útil. Con el volumen histórico de octubre (miles de mensajes, no millones) es un costo aceptable si la consulta está paginada y el término tiene longitud mínima. No es un motivo para Full-Text Search todavía.

No se midió el plan de ejecución. **Pendiente de validación** en SQL TEST con un `SET STATISTICS IO` sobre una copia anonimizada.

## Búsqueda — entrega incremental

### PR 1 — honestidad de lo que ya existe

- Placeholder: teléfono, nombre o texto del mensaje.
- Longitud mínima 2 caracteres.
- Tope de `limit` ya existente de la lista; no quitar el offset.
- Documentar que email no matchea, o agregar `contact_email` al mismo `OR` si el equipo lo quiere en el mismo PR. Es un cambio chico y compatible.

### PR 2 — resultados de mensajes

`GET /api/conversations/search?q=&from=&to=&senderType=&limit=&cursor=`

- Parametrizado.
- Misma normalización de acentos **en la comparación**, o `Latin1_General_CI_AI` si la collation de la columna no es acento-insensible. Verificar collation antes de elegir. No instalar FULLTEXT en este PR.
- Orden estable `created_at`, `id`.
- Cada hit: `conversationId`, `messageId`, `createdAt`, `senderType`, fragmento de ~80 caracteres alrededor del match con el término, sin devolver el hilo completo.
- Autorización: el mismo `requireAuth` del inbox. No hay multitenant en el esquema. Cuando exista alcance por equipo, este endpoint usa el mismo predicado que la lista.
- El cliente abre la conversación y pide el timeline con un `focusMessageId`. El timeline hace scroll a esa fila. Si la página de mensajes no la incluye, un fetch con `aroundMessageId`.
- No loguear `q`.

### PR 3 — FULLTEXT, solo si PR 2 se pone lento

Criterio para abrirlo: p95 por encima de un umbral acordado (propuesta 500 ms en TEST con el volumen real anonimizado) o crecimiento sostenido del cuerpo. Índice FULLTEXT sobre `body`, consultas con `CONTAINS`, sin cambiar el contrato del API. Stopwords en español a revisar para que «de» y «tea» no vacíen resultados; por eso no es el primer paso.

## Permisos y datos sensibles

Fotos de DNI y PDF de alumnos van a aparecer. El endpoint de descarga queda detrás de sesión. No hay URL firmada de larga vida en el JSON del timeline: el cliente pide el binario con cookie. Auditoría de descarga puede esperar; no es el P0. Sí lo es no mezclar attachments entre conversaciones (test de id ajeno → 404).

## Aceptación

- JPEG, PNG y PDF se ven desde el panel con sesión válida.
- MIME fuera de lista y archivo grande: `failed` o 400, sin fila binaria.
- Media inexistente o URL Twilio vencida: estado `failed`, el resto del chat sigue.
- Usuario de otra sesión no descarga el archivo (en este sistema: request sin cookie → 401; id de otra conversación → 404).
- Nombre de archivo con `../` o HTML no altera path ni el DOM.
- Envío duplicado con el mismo `clientRequestId` no crea dos SID.
- Búsqueda «inscripción» encuentra el mensaje, muestra fragmento y posiciona el timeline.
- Búsqueda por teléfono sigue encontrando la conversación aunque la palabra no esté en los mensajes.
- Un término no se escribe en logs de aplicación.
