-- Phase 2: human handoff queue (SQL Server)

IF OBJECT_ID(N'dbo.human_handoffs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.human_handoffs (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_human_handoffs_id DEFAULT NEWID(),
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    requested_by NVARCHAR(50) NOT NULL,
    reason NVARCHAR(MAX) NULL,
    status NVARCHAR(50) NOT NULL CONSTRAINT DF_human_handoffs_status DEFAULT N'pending',
    assigned_agent_id UNIQUEIDENTIFIER NULL,
    requested_at DATETIME2 NOT NULL CONSTRAINT DF_human_handoffs_requested_at DEFAULT SYSUTCDATETIME(),
    assigned_at DATETIME2 NULL,
    resolved_at DATETIME2 NULL,
    resolution_note NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_human_handoffs_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_human_handoffs_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_human_handoffs PRIMARY KEY (id),
    CONSTRAINT FK_human_handoffs_conversation
      FOREIGN KEY (conversation_id) REFERENCES dbo.conversations (id) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_human_handoffs_conversation_id' AND object_id = OBJECT_ID(N'dbo.human_handoffs'))
  CREATE INDEX idx_human_handoffs_conversation_id ON dbo.human_handoffs (conversation_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_human_handoffs_status_requested_at' AND object_id = OBJECT_ID(N'dbo.human_handoffs'))
  CREATE INDEX idx_human_handoffs_status_requested_at ON dbo.human_handoffs (status, requested_at DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversations_status_last_message' AND object_id = OBJECT_ID(N'dbo.conversations'))
  CREATE INDEX idx_conversations_status_last_message ON dbo.conversations (status, last_message_at DESC);
GO
