-- DIN-439 hardening (post-011). No modifica 011; amplía columnas y reglas.

IF COL_LENGTH(N'dbo.conversation_message_attachments', N'source_url') IS NULL
BEGIN
  ALTER TABLE dbo.conversation_message_attachments
    ADD source_url NVARCHAR(2048) NULL;
END;
GO

IF COL_LENGTH(N'dbo.conversation_message_attachments', N'retry_count') IS NULL
BEGIN
  ALTER TABLE dbo.conversation_message_attachments
    ADD retry_count INT NOT NULL CONSTRAINT DF_conversation_message_attachments_retry_count DEFAULT 0;
END;
GO

IF COL_LENGTH(N'dbo.conversation_message_attachments', N'next_retry_at') IS NULL
BEGIN
  ALTER TABLE dbo.conversation_message_attachments
    ADD next_retry_at DATETIME2 NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = N'CK_conversation_message_attachments_status'
)
BEGIN
  ALTER TABLE dbo.conversation_message_attachments
    ADD CONSTRAINT CK_conversation_message_attachments_status
    CHECK (status IN (N'pending', N'downloading', N'stored', N'failed'));
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'idx_conversation_message_attachments_storage_key'
    AND object_id = OBJECT_ID(N'dbo.conversation_message_attachments')
)
BEGIN
  CREATE UNIQUE INDEX idx_conversation_message_attachments_storage_key
    ON dbo.conversation_message_attachments (storage_key)
    WHERE storage_key IS NOT NULL AND storage_key <> N'';
END;
GO

IF OBJECT_ID(N'dbo.trg_conversation_message_attachments_conversation_match', N'TR') IS NULL
EXEC(N'
CREATE TRIGGER dbo.trg_conversation_message_attachments_conversation_match
ON dbo.conversation_message_attachments
AFTER INSERT, UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (
    SELECT 1
    FROM inserted i
    INNER JOIN dbo.conversation_messages m ON m.id = i.message_id
    WHERE m.conversation_id <> i.conversation_id
  )
  BEGIN
    THROW 51001, N''conversation_message_attachments.conversation_id must match message'', 1;
  END;
END;
');
GO