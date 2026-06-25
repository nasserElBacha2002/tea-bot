-- Contact email on conversations (durable per phone + channel, synced like display_name)

IF COL_LENGTH('dbo.conversations', 'contact_email') IS NULL
BEGIN
  ALTER TABLE dbo.conversations
    ADD contact_email NVARCHAR(320) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'idx_conversations_contact_email'
    AND object_id = OBJECT_ID(N'dbo.conversations')
)
  CREATE INDEX idx_conversations_contact_email
    ON dbo.conversations (contact_email)
    WHERE contact_email IS NOT NULL AND contact_email <> N'';
GO
