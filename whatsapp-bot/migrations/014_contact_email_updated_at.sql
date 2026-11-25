-- DIN-432: timestamp dedicado para actualizaciones de contact_email (no confundir con updated_at general)

IF COL_LENGTH('dbo.conversations', 'contact_email_updated_at') IS NULL
BEGIN
  ALTER TABLE dbo.conversations
    ADD contact_email_updated_at DATETIME2 NULL;
END;
GO