---
name: sql-integration-gate
description: Validar suites de integración SQL Server antes de cerrar tickets de concurrencia/idempotencia en Tea Bot.
disable-model-invocation: true
---

# SQL integration gate

## When

Inbound idempotency, webhook leases, takeover distributed tests, migration 007+.

## Checklist

1. Confirm isolated DB helper usage in touched `*.integration.test.js`.
2. Run `cd whatsapp-bot && npm test` (or targeted files if user scoped).
3. On flake: diagnose shared DB, parallel contention, stale lease timing — propose minimal fix, not suite rewrite.
4. Report: files run, pass/fail, root cause if flaky, reproduction steps.

## Rules

No production credentials. No weakening Twilio signature or idempotency for test convenience.
