BLOCKED_PREDEPLOY

Fecha: 2026-11-10. No se desplegó TB-005 ni TB-006.

El VPS no tiene host, usuario ni directorio verificables. No hay SSH config ni acceso autorizado a Tea Bot. Las claves SSH existentes son de otros proyectos y no se usaron. Docker solo tiene contextos locales. No se infirió un destino.

Por ese corte no se hizo backup, no se leyeron migraciones productivas, no se aplicó 007, 008 ni 010, y no se aplicó 009. No se configuró `TWILIO_SIGNATURE_MODE=log`. No se activó `enforce` ni takeover. No se tocó Nginx ni Twilio Console. No hubo commit ni push.

Git local, confirmado con `git fetch`:

- rama `main`;
- `origin/main` `ac7e69960f133cb32add5a140972329074cbf9fa`;
- local `b0d606b7c120edd7cc75f555d326cd89fefd01d7`, 1 adelante y 0 atrás;
- correcciones TB-005 todavía sin commit;
- sin workflow de deploy dentro del repositorio;
- API de GitHub no autenticada, así que un webhook externo no quedó descartado.

`origin/main` no contiene TB-005 ni el cierre TB-006. El SHA productivo sigue sin conocerse.

Para salir de este estado hace falta, antes de publicar `main`:

1. Acceso SSH ya autorizado, con host y usuario explícitos del VPS de Tea Bot.
2. Directorio, Compose, SHA e imagen actuales.
3. Identidad de SQL Server productivo, distinta de la base local `tea-bot`.
4. Backup nuevo verificado con `RESTORE VERIFYONLY WITH CHECKSUM`.
5. 007, 008 si corresponde, y 010 aplicadas solo si faltan. 009 fuera.
6. `node scripts/tb006-preflight.js --execute` con `ready: true`.
7. URL pública real de inbound y status, y la ruta que Express recibe, sin prefijo duplicado.
8. Preflight de firma en esa configuración: `mode: log`, `ready: true`, exit 0.
9. Recién entonces commit de las correcciones, push a `origin/main` y recreación del backend.

Hasta que eso exista, el modo productivo no es `log` y la validación en vivo no está hecha.
