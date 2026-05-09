# Registro de conversaciones finalizadas

## Cuándo se registra

Se exporta una fila por conversación cuando ocurre alguno de estos eventos:

- Nodo terminal (`isTerminal: true`) o nodo `end`.
- Derivación humana (`terminalReason: "human_handoff"` o comando global humano).
- Cancelación explícita del usuario (`salir`, `cancelar`, `terminar`).

No se registra abandono por timeout en esta versión.

## Datos que se guardan

En la pestaña principal del Sheet, **una fila por conversación finalizada** con **13 columnas** fijas (orden): Fecha de inicio, Fecha de cierre, Teléfono, Tipo de usuario, Consulta principal, Detalle de consulta, Estado de la conversación, Requiere atención humana, Motivo de cierre, Acción sugerida, Recorrido resumido, Último mensaje del usuario, Observaciones.

Opcionalmente, si está configurada la pestaña raw (`GOOGLE_SHEETS_RAW_TAB_NAME`), allí puede guardarse un JSON con datos técnicos adicionales para auditoría.

## Tracking en el JSON del flujo

### Nodo terminal

```json
{
  "id": "human_handoff",
  "type": "message",
  "message": "Te vamos a derivar con una persona del equipo.",
  "isTerminal": true,
  "terminalReason": "human_handoff"
}
```

### Tracking de transición

```json
{
  "type": "match",
  "value": "1",
  "nextNode": "alumni_yes",
  "track": {
    "key": "es_estudiante",
    "value": "SI"
  }
}
```

## Configuración Google Sheets

```bash
GOOGLE_SHEETS_ENABLED=true
GOOGLE_SHEETS_SPREADSHEET_ID=<id>
GOOGLE_SHEETS_TAB_NAME=Conversaciones
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Si `GOOGLE_SHEETS_ENABLED=false`, el export se omite.
Si está habilitado y faltan variables, el sistema avisa al iniciar.

## Comportamiento ante errores

- Si falla Google Sheets, el bot **no** se cae ni bloquea la respuesta.
- Se loguea el error y se guarda la marca de error de export en la sesión.
