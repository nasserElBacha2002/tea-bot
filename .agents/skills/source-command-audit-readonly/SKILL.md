---
name: "source-command-audit-readonly"
description: "Migrated source command `audit-readonly`"
---

# source-command-audit-readonly

Use this skill when the user asks to run the migrated source command `audit-readonly`.

## Command Template

# audit-readonly

**ROLE**  
Senior/Staff engineer: **read-only** audit for Tea Bot (Node, React, SQL Server, Twilio).

**GOAL**  
Produce an actionable report. **Do not modify files**, run migrations, or deploy.

## Scope

Use repo code, README, `whatsapp-bot/package.json`, `frontend/package.json`, and the user’s ticket (DIN/TB/P0).

## Workflow

1. Confirm ticket scope; stop if ambiguous.
2. Trace affected flows: webhook → pipeline → services → SQL → admin API → React features.
3. Check invariants: Twilio signature, inbound idempotency/leases, `status_version`, roles, flows in SQL.
4. Map tests that prove the behavior; note gaps.
5. Output: **Done** / **Partial** / **Open** per item, evidence (paths/tests), risks, minimal fix list.

## Out of scope unless asked

Implementation, refactors, dependency bumps, `TWILIO_SIGNATURE_MODE=enforce`, production deploy.
