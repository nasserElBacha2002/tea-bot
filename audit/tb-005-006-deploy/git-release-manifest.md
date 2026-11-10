# Manifiesto Git — no publicado

Fecha: 2026-11-10. No se creó commit ni se hizo push en esta tarea.

## Posición

| Ref | SHA | Publicado |
| --- | --- | --- |
| `origin/main` | `ac7e69960f133cb32add5a140972329074cbf9fa` | sí |
| `main` local | `b0d606b7c120edd7cc75f555d326cd89fefd01d7` | no |
| Working tree | correcciones TB-005 encima de `b0d606b` | no |

`main` está 1 commit adelante y 0 atrás. No hay otra rama. No hubo rebase, reset ni force push.

## Qué falta para que producción tenga TB-005 y TB-006

`origin/main` (`ac7e699`) no incluye el cierre TB-006 ni TB-005 que están en `b0d606b`, ni las correcciones sin commit:

- contrato de URL sin heurística;
- preflight `scripts/twilio-signature-preflight.js`;
- `createApp()`;
- rechazo de `log`/`enforce` si la configuración no puede verificar;
- cleanup SQL por ids creados en el test.

Publicar solo `b0d606b` dejaría fuera esas correcciones. El review las marcó como previas al merge.

## Qué no debe entrar en un commit futuro

- `.env` real, backups, logs.
- `audit/tb-005-006-deploy/` (este informe).
- `audit/tb-005-corrections/` salvo decisión explícita.

`b0d606b` ya contiene auditorías de TB-005 y TB-006. No se reescribe. Si más adelante se publica `main`, ese contenido viaja con el commit existente.

## CI

No hay workflow en el árbol de `origin/main`. Los hooks locales no están activos. `gh` no tiene sesión, así que un deploy configurado fuera del repositorio no quedó descartado por API. Por eso, y porque el VPS no está preparado, no se publicó `main`.

## Suite

La última corrida registrada de este working tree, en `audit/tb-005-corrections/implementation-corrections-tests.txt`, fue exit 0: 409 pass, 0 fail, 2 skipped. Los skips piden la migración 009. Esta sesión no repitió la suite porque el despliegue se abortó en la identidad del VPS.
