-- Replay del TwiML ya comprometido para un inbound PROCESSED.
-- No es la autoridad de idempotencia: esa sigue siendo el estado y el attempts.
-- Sin esta columna el retry de un evento PROCESSED responde TwiML vacío.
-- Rollback: no dropear la columna. El código anterior la ignora.

IF COL_LENGTH(N'dbo.provider_webhook_events', N'response_body') IS NULL
BEGIN
  ALTER TABLE dbo.provider_webhook_events
    ADD response_body NVARCHAR(MAX) NULL;
END;
GO
