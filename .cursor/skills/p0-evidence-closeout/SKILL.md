---
name: p0-evidence-closeout
description: Cierre formal de tickets P0 Tea Bot con evidencia ejecutada. Usar al cerrar DIN/TB tras implementación o validación.
disable-model-invocation: true
---

# P0 evidence closeout

Apply `AGENTS.md` and `.cursor/rules/tea-bot-core.mdc`.

## Inputs

Ticket id, prior audit status, what the user claims is done.

## Steps

1. Re-read ticket acceptance criteria; list each as **Verified** / **Partial** / **Open**.
2. Run only repo-discovered commands (typically `whatsapp-bot/npm test`, `frontend/npm test`, `typecheck`, `db:migrate:status`).
3. Distinguish executed vs reasoned-only checks.
4. Produce closing block: estado por criterio, comandos + salida resumida, archivos tocados, riesgos, rollback, no verificado.
5. Do not mark production-complete without user-confirmed smoke unless the ticket only asks for code/tests.

## Mode

Read-only validation unless the user asked to fix remaining gaps in the same turn.
