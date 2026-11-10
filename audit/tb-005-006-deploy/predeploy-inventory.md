# Inventario predeploy — 2026-11-10

Estado de esta fase: el despliegue no empieza. No hay un VPS identificable con acceso ya autorizado.

## Local

- Rama única en uso: `main`. No se creó otra rama.
- `HEAD`: `b0d606b7c120edd7cc75f555d326cd89fefd01d7` (`updates`, 2026-11-10 13:01:11 -0300).
- `origin/main`: `ac7e69960f133cb32add5a140972329074cbf9fa`.
- `git fetch origin` completó. `origin/main...main` = `0 1`: el remoto no tiene commits que falten en local. Local tiene un commit que el remoto no tiene.
- No hay divergencia ni conflictos. `origin/main` es ancestro de `HEAD`.
- Remoto: `https://github.com/nasserElBacha2002/tea-bot.git`.
- `gh` no está autenticado. No se consultó la API de GitHub Actions.
- En `origin/main` no hay `.github/workflows`, `Jenkinsfile` ni `.gitlab-ci.yml`. Los hooks de `.git/hooks` son los samples. No hay evidencia en el repositorio de un deploy automático al pushear `main`. Un webhook configurado solo en GitHub no pudo comprobarse.

## Qué está solo en local

Commit no publicado `b0d606b`:

- Cierre TB-006: `tb006-preflight.js`, `webhook-dead-letter.js`, `webhook-events.service.js`, `db/index.js`, tests de acquire e idempotencia.
- Primera implementación TB-005: `verify-twilio-signature.js`, modo en `config.js`, rutas y tests de firma.
- También versiona `audit/tb-005-signature/` y `audit/tb-006-final/`. Este deploy no reescribe ese commit.

Cambios todavía sin commit, que son las correcciones de review de TB-005:

- `whatsapp-bot/.env.example`
- `whatsapp-bot/src/app.js`
- `whatsapp-bot/src/config.js`
- `whatsapp-bot/src/middleware/verify-twilio-signature.js`
- `whatsapp-bot/src/middleware/twilio-inbound-signature.test.js`
- `whatsapp-bot/src/middleware/twilio-inbound-signature.integration.test.js`
- `whatsapp-bot/scripts/twilio-signature-preflight.js` (nuevo)
- `whatsapp-bot/src/create-app.js` (nuevo)
- `whatsapp-bot/src/middleware/twilio-signature-app.test.js` (nuevo)
- `whatsapp-bot/src/middleware/twilio-signature-url.test.js` (nuevo)

`audit/tb-005-corrections/` está fuera del commit a propósito. Parte de esos archivos los ignora `.gitignore`.

No hay `.env` real en el diff. No hay archivos de otro ticket en el working tree. La suite de esta sesión de deploy no se volvió a ejecutar: el corte ocurrió antes de publicar.

## VPS

No desplegado y no inspeccionado.

- No existe `~/.ssh/config`.
- No hay una clave ni un alias cuyo nombre identifique Tea Bot.
- Las claves presentes pertenecen a otros proyectos. No se usaron.
- Los contextos Docker son locales (`unix` socket y Docker Desktop). No hay un contexto remoto.
- El repositorio no documenta host, usuario, directorio, Compose productivo ni script de deploy del VPS.
- No se infirió un destino. No se abrió SSH.

Sin esa identidad no hay baseline de contenedor, SQL, Nginx, TLS, disco ni SHA desplegado.

## Twilio y Nginx productivo

No verificados. No se consultó Twilio Console ni su API. `frontend/nginx.conf` solo sirve el frontend y no es la configuración del VPS.
