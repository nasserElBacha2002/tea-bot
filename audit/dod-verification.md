# Definition of Done — Verificación integral (Fases 1–5)

## Cómo verificar en local (flujo de aceptación)

```bash
docker compose up -d sqlserver
cd whatsapp-bot
# .env: CONVERSATION_DB_ENABLED=true, DB_*, FLOW_STORAGE_MODE=db
npm run db:setup-local   # migrate + import-flows + seed
npm run db:verify
FLOW_STORAGE_MODE=db npm run dev
```

Frontend: login → `/conversations`.

### Prueba crítica: sin JSON en runtime

```bash
mv data/flows data/flows_DISABLED
FLOW_STORAGE_MODE=db npm run dev
# El bot debe arrancar y cargar main-menu desde DB (log [DbFlowLoader])
mv data/flows_DISABLED data/flows
```

---

## Fase 1 — Persistencia conversaciones

| Criterio | Estado |
|----------|--------|
| Tablas conversations, messages, sessions | ✅ migración 001 |
| Webhook crea/reutiliza conversación | ✅ |
| Inbound/outbound persistidos | ✅ |
| Sesión en conversation_sessions | ✅ |
| current_flow_id / node / version | ✅ (version desde cache loader en sync) |
| Teléfono E.164, no literal `whatsapp` | ✅ `normalizeTwilioWhatsappNumber` |
| Repos + sin SQL en controllers | ✅ |
| Lista vacía → 200, no error | ✅ inbox |

---

## Fase 2 — Handoff humano

| Criterio | Estado |
|----------|--------|
| human_handoffs | ✅ migración 002 |
| Detección human_handoff | ✅ handoff-detection + FlowEngine |
| waiting_human + sesión paused | ✅ HumanHandoffService |
| Confirmación + metadata event | ✅ |
| Mensajes en modo humano sin FlowEngine | ✅ webhook skip |
| Sin handoffs duplicados pending | ✅ ensurePendingHandoff |
| metadata botSkipped | ✅ |

---

## Fase 3 — Inbox

| Criterio | Estado |
|----------|--------|
| GET /api/conversations (+ detail, messages) | ✅ |
| Filtros, búsqueda, paginación | ✅ |
| UI español, timeline, refresh | ✅ `/conversations` |
| 503 solo si DB caída + mensaje claro | ✅ Fase 4 |

---

## Fase 4 — Respuesta humana

| Criterio | Estado |
|----------|--------|
| claim / messages / close / return-to-bot | ✅ |
| provider=twilio → Twilio | ✅ |
| provider=internal → solo DB | ✅ |
| Seed SIM-* sin Twilio | ✅ |
| Error persistencia estructurado | ✅ CONVERSATION_PERSISTENCE_UNAVAILABLE |

---

## Fase 5 — Flujos en DB + seed

| Criterio | Estado |
|----------|--------|
| Tablas flows … snapshots | ✅ migración 003 |
| npm run db:import-flows idempotente (checksum) | ✅ |
| Validación post-import | ✅ flowValidator + conteos |
| FLOW_STORAGE_MODE json / db / db_with_json_fallback | ✅ |
| Modo `db` sin fallback silencioso a JSON | ✅ |
| DbFlowLoader + log explícito | ✅ |
| npm run db:seed-conversations | ✅ |
| npm run db:verify | ✅ |
| Docker default FLOW_STORAGE_MODE=db | ✅ compose |

**Idempotencia import:** si el checksum del archivo no cambió, se omite la reimportación; si cambió, se borran nodos/transiciones/snapshot de esa versión y se reinsertan.

---

## Pendiente / fuera de alcance

- Editor visual de flujos (Fase 6)
- Publicar flujos solo en DB sin escribir JSON (admin sigue usando archivos + import)
- WebSockets / analytics
- Tabla `users` (agente = UUID derivado de cookie admin)

---

## Comandos útiles

| Comando | Uso |
|---------|-----|
| `npm run db:migrate` | Esquema SQL |
| `npm run db:import-flows` | JSON → DB |
| `npm run db:seed-conversations` | Inbox sin Twilio |
| `npm run db:verify` | Chequeo DoD automatizado |
| `npm run db:setup-local` | migrate + import + seed |
