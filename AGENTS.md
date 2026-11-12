# AGENTS.md — Tea Bot

Instrucciones locales para agentes. Los `AGENTS.md` anidados complementan este archivo.

## Stack

- `whatsapp-bot/`: Node.js (ESM), Express, SQL Server, Twilio WhatsApp; tests con `node --test` y `scripts/run-test-suite.js`.
- `frontend/`: React, Vite, Vitest, MUI; features bajo `frontend/src/features/`.
- Deploy: Docker Compose, Nginx; migraciones en `whatsapp-bot` (`npm run db:migrate`).

## Inspección previa (obligatoria)

1. Leer README, `whatsapp-bot/package.json`, `frontend/package.json`, CI si existe.
2. Identificar scripts reales: `npm test`, `db:migrate`, integración SQL.
3. Leer código y tests **relacionados** al cambio antes de editar.

## Comportamiento

- Respetar capas: controllers → services → repositories; frontend features colocalizadas.
- Concurrencia SQL: idempotencia inbound Twilio, leases, `status_version`, takeover manual.
- No debilitar verificación de firma Twilio ni roles (`admin`, `conversations_only`) sin pedido explícito.
- Cambios mínimos en correcciones de review; no reescribir features completas salvo ticket explícito.
- No commitear `.env`, credenciales ni datos productivos.
- Ejecutar tests descubiertos en el área tocada; no afirmar éxito si fallan.
- Sin `commit`, `push`, deploy productivo ni `TWILIO_SIGNATURE_MODE=enforce` sin autorización explícita.

## Verificación habitual

- Backend: `cd whatsapp-bot && npm test` (y suites de integración SQL cuando aplique).
- Frontend: `cd frontend && npm test` y `npm run typecheck`.
- Migraciones: `npm run db:migrate:status` antes de deploy.

## Cursor

| Superficie | Uso |
|------------|-----|
| `/audit-readonly` | Auditoría P0 sin edits |
| `/corrections-scoped` | Solo hallazgos de review |
| `/deploy-controlled` | Deploy con checklist |
| Skill `p0-evidence-closeout` | Cierre con evidencia |
| Skill `sql-integration-gate` | Tests SQL aislados |
| Agent `code-reviewer` | Review diff |
| Agent `sre-deploy` | Migraciones y Docker |

## Cierre

Listar archivos tocados, comandos ejecutados, riesgos y lo no verificado.
