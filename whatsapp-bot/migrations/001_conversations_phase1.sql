-- Phase 1: conversations, messages, sessions (SQL Server — flujos siguen en JSON)

IF OBJECT_ID(N'dbo.conversations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversations (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversations_id DEFAULT NEWID(),
    channel NVARCHAR(32) NOT NULL,
    provider NVARCHAR(32) NOT NULL,
    external_user_id NVARCHAR(255) NOT NULL,
    phone_number NVARCHAR(64) NULL,
    display_name NVARCHAR(255) NULL,
    status NVARCHAR(32) NOT NULL CONSTRAINT DF_conversations_status DEFAULT N'bot',
    current_flow_id NVARCHAR(128) NULL,
    current_flow_version NVARCHAR(32) NULL,
    current_node_key NVARCHAR(128) NULL,
    assigned_agent_id UNIQUEIDENTIFIER NULL,
    last_message_at DATETIME2 NULL,
    started_at DATETIME2 NOT NULL CONSTRAINT DF_conversations_started_at DEFAULT SYSUTCDATETIME(),
    closed_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversations_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_conversations_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_conversations PRIMARY KEY (id),
    CONSTRAINT UQ_conversations_channel_external_user UNIQUE (channel, external_user_id)
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversations_phone_number' AND object_id = OBJECT_ID(N'dbo.conversations'))
  CREATE INDEX idx_conversations_phone_number ON dbo.conversations (phone_number);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversations_status' AND object_id = OBJECT_ID(N'dbo.conversations'))
  CREATE INDEX idx_conversations_status ON dbo.conversations (status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversations_last_message_at' AND object_id = OBJECT_ID(N'dbo.conversations'))
  CREATE INDEX idx_conversations_last_message_at ON dbo.conversations (last_message_at DESC);
GO

IF OBJECT_ID(N'dbo.conversation_messages', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_messages (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_messages_id DEFAULT NEWID(),
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    direction NVARCHAR(16) NOT NULL,
    sender_type NVARCHAR(16) NOT NULL,
    body NVARCHAR(MAX) NOT NULL CONSTRAINT DF_conversation_messages_body DEFAULT N'',
    provider NVARCHAR(32) NOT NULL,
    provider_message_id NVARCHAR(128) NULL,
    raw_payload_json NVARCHAR(MAX) NULL,
    metadata_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_messages_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_conversation_messages PRIMARY KEY (id),
    CONSTRAINT FK_conversation_messages_conversation
      FOREIGN KEY (conversation_id) REFERENCES dbo.conversations (id) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversation_messages_conversation_id' AND object_id = OBJECT_ID(N'dbo.conversation_messages'))
  CREATE INDEX idx_conversation_messages_conversation_id
    ON dbo.conversation_messages (conversation_id, created_at ASC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversation_messages_provider_message_id' AND object_id = OBJECT_ID(N'dbo.conversation_messages'))
  CREATE UNIQUE NONCLUSTERED INDEX idx_conversation_messages_provider_message_id
    ON dbo.conversation_messages (provider, provider_message_id)
    WHERE provider_message_id IS NOT NULL AND provider_message_id <> N'';
GO

IF OBJECT_ID(N'dbo.conversation_sessions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_sessions (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_sessions_id DEFAULT NEWID(),
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    flow_id NVARCHAR(128) NOT NULL,
    flow_version NVARCHAR(32) NULL,
    current_node_key NVARCHAR(128) NULL,
    variables_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_conversation_sessions_variables DEFAULT N'{}',
    history_json NVARCHAR(MAX) NOT NULL CONSTRAINT DF_conversation_sessions_history DEFAULT N'[]',
    status NVARCHAR(16) NOT NULL CONSTRAINT DF_conversation_sessions_status DEFAULT N'active',
    started_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_sessions_started_at DEFAULT SYSUTCDATETIME(),
    ended_at DATETIME2 NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_sessions_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_conversation_sessions PRIMARY KEY (id),
    CONSTRAINT FK_conversation_sessions_conversation
      FOREIGN KEY (conversation_id) REFERENCES dbo.conversations (id) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversation_sessions_conversation_id' AND object_id = OBJECT_ID(N'dbo.conversation_sessions'))
  CREATE INDEX idx_conversation_sessions_conversation_id
    ON dbo.conversation_sessions (conversation_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_conversation_sessions_active' AND object_id = OBJECT_ID(N'dbo.conversation_sessions'))
  CREATE INDEX idx_conversation_sessions_active
    ON dbo.conversation_sessions (conversation_id)
    WHERE status = N'active';
GO
