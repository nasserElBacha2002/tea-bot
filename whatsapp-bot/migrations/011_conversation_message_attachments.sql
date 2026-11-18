-- DIN-439: metadata de adjuntos inbound (binarios en disco privado, no en SQL).

IF OBJECT_ID(N'dbo.conversation_message_attachments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_message_attachments (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_message_attachments_id DEFAULT NEWID(),
    message_id UNIQUEIDENTIFIER NOT NULL,
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    ordinal INT NOT NULL,
    provider_media_index INT NOT NULL,
    mime_type NVARCHAR(128) NULL,
    byte_size BIGINT NULL,
    original_name NVARCHAR(255) NULL,
    storage_key NVARCHAR(128) NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT DF_conversation_message_attachments_status DEFAULT N'pending',
    failure_reason NVARCHAR(128) NULL,
    sha256 CHAR(64) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_message_attachments_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_message_attachments_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_conversation_message_attachments PRIMARY KEY (id),
    CONSTRAINT FK_conversation_message_attachments_message
      FOREIGN KEY (message_id) REFERENCES dbo.conversation_messages (id) ON DELETE CASCADE,
    CONSTRAINT UQ_conversation_message_attachments_message_ordinal UNIQUE (message_id, ordinal)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'idx_conversation_message_attachments_conversation_id'
    AND object_id = OBJECT_ID(N'dbo.conversation_message_attachments')
)
  CREATE INDEX idx_conversation_message_attachments_conversation_id
    ON dbo.conversation_message_attachments (conversation_id, created_at ASC);
GO