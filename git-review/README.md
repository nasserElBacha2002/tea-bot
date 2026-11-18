# git-review

Artefactos generados para revisión local (diff, stat, status, tests). **No versionar** — están en `.gitignore`.

Estructura por ticket o rama:

```
git-review/<id-o-rama>/
  git.diff          # git diff del alcance acordado
  git-diff-stat.txt
  git-status.txt
  test-results.txt  # opcional, cuando aplique
```

Regenerar DIN-439 (solo `whatsapp-bot/`):

```bash
git add -N whatsapp-bot/migrations/011_conversation_message_attachments.sql \
  whatsapp-bot/src/monitoring/migration-011.test.js \
  whatsapp-bot/src/repositories/conversation-message-attachment.repository.js \
  whatsapp-bot/src/services/inbound-media-din439.integration.test.js \
  whatsapp-bot/src/services/inbound-media.service.js \
  whatsapp-bot/src/services/inbound-media.service.test.js \
  whatsapp-bot/src/utils/inbound-media-policy.js
mkdir -p git-review/din-439
git diff -- whatsapp-bot/ > git-review/din-439/git.diff
git diff --stat -- whatsapp-bot/ > git-review/din-439/git-diff-stat.txt
git status -- whatsapp-bot/ > git-review/din-439/git-status.txt
```