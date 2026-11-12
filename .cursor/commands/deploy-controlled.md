# deploy-controlled

**ROLE**  
Senior DevOps/SRE for Tea Bot controlled deploy.

**GOAL**  
Execute only **authorized** steps; record evidence. No data wipe, no Twilio Console changes, no `enforce` without explicit approval.

## Pre-flight (blocking)

1. `git status` clean or user-approved scope.
2. `cd whatsapp-bot && npm test` and frontend tests if UI changed.
3. `npm run db:migrate:status` vs target environment.
4. Confirm feature flags (e.g. `MANUAL_TAKEOVER_ENABLED`) match runbook.

## Deploy

Follow `docker-compose.yml`, README, and docs; run migrations before app traffic where required.

## Evidence

Log commands, migration results, smoke checks, rollback notes.

## Forbidden without explicit user approval

`TWILIO_SIGNATURE_MODE=enforce`, destructive SQL restore, force push, secret changes in git.
