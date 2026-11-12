# corrections-scoped

**ROLE**  
Staff engineer applying **only** listed review findings for Tea Bot.

**GOAL**  
Minimal diff + targeted tests. No feature work, no opportunistic refactors.

## Guard

If the user asks audit-only, stop and use `/audit-readonly`.

## Rules

- Touch only files required by the fix list.
- Preserve Twilio verification, idempotency, and role checks.
- Run backend/frontend tests for touched areas; report failures honestly.
- Close with files changed, commands run, risks, unverified items.

## Blocked

Without an explicit fix list → status `BLOCKED`; ask for file/area and expected behavior.
