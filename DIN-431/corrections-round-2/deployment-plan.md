# Deploy

1. `CONVERSATION_RETENTION_ENABLED=false`
2. `npm run db:migrate` — **013 obligatoria** (sin 013 el job aborta TX si hay adjuntos)
3. Smoke + `TB_SQL_TEST_CONFIRM=tea-bot npm test` en pre-prod
4. Habilitar retención