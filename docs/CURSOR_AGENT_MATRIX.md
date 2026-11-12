# Matriz Cursor — proyectos principales

Actualizado: 2026-11-12. Ver en **Customize → Workspace** al abrir cada repo.

| Proyecto | Rules | Commands | Skills | Agents | AGENTS.md |
|----------|-------|----------|--------|--------|-----------|
| Tea-bot | `tea-bot-core`, `sql-integration-tests` | audit-readonly, corrections-scoped, deploy-controlled | p0-evidence-closeout, sql-integration-gate | code-reviewer, sre-deploy | Raíz |
| dinamic-localizador | project-rule | (existentes) | phase-audit, phase-implement, phase-deploy | code-reviewer | Sí |
| dinamic-gemini | project-rule | (existentes) | phase-audit, phase-corrections, prod-readiness, cv-inventory-assistant | code-reviewer, pipeline-reviewer | Anidados |
| dinamic-security-agents | 3× security rules | security-audit-* | validate/sast (existentes) | security-auditor | Sí |
| dinamic-clean-personal | dinamic-clean | audit/implement/fix stage | stage-audit, stage-implement, review-fix | software-architect, backend/frontend/database-senior | Sí |
| nexxtrust | monorepo + contracts core | audit-readonly, corrections-scoped | monorepo-audit, contracts-gate | code-reviewer | Raíz + contracts |
| estudiocristi | engineering + overlay | audit, fix, validate, pre-merge | (existentes 10+) | code-reviewer | Sí |
| trivia-uruguay-meats | desktop-zero-config | audit-readonly, corrections-scoped | desktop-validate, feria-smoke | code-reviewer | Sí |
| UADE/cursos | — | — | — | — | User Rules globales |

**Global (User):** Rules en Cursor Settings, hooks `~/.cursor/hooks.json`, MCP `~/.cursor/mcp.json`, Automations en Agents Window.
