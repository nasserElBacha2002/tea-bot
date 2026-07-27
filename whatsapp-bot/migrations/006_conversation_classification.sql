-- Conversation classification, tracking persistence, and sheet export index

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.conversation_sessions') AND name = N'tracking_json'
)
BEGIN
  ALTER TABLE dbo.conversation_sessions
    ADD tracking_json NVARCHAR(MAX) NOT NULL
      CONSTRAINT DF_conversation_sessions_tracking DEFAULT N'{}';
END;
GO

IF OBJECT_ID(N'dbo.conversation_classifications', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_classifications (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_classifications_id DEFAULT NEWID(),
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    classifier_version NVARCHAR(32) NOT NULL,
    primary_query NVARCHAR(255) NULL,
    modality NVARCHAR(32) NULL,
    program_type NVARCHAR(32) NULL,
    program_name NVARCHAR(128) NULL,
    specific_reason NVARCHAR(64) NULL,
    responsible_area NVARCHAR(64) NULL,
    source NVARCHAR(32) NOT NULL,
    confidence DECIMAL(5,4) NOT NULL CONSTRAINT DF_conversation_classifications_confidence DEFAULT 0,
    matched_rule NVARCHAR(128) NULL,
    matched_node NVARCHAR(128) NULL,
    flow_id NVARCHAR(128) NULL,
    flow_version NVARCHAR(32) NULL,
    is_active BIT NOT NULL CONSTRAINT DF_conversation_classifications_is_active DEFAULT 1,
    classified_at DATETIME2 NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_classifications_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_classifications_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_conversation_classifications PRIMARY KEY (id),
    CONSTRAINT FK_conversation_classifications_conversation
      FOREIGN KEY (conversation_id) REFERENCES dbo.conversations (id) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'idx_conversation_classifications_active'
    AND object_id = OBJECT_ID(N'dbo.conversation_classifications')
)
  CREATE UNIQUE INDEX idx_conversation_classifications_active
    ON dbo.conversation_classifications (conversation_id)
    WHERE is_active = 1;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'idx_conversation_classifications_classified_at'
    AND object_id = OBJECT_ID(N'dbo.conversation_classifications')
)
  CREATE INDEX idx_conversation_classifications_classified_at
    ON dbo.conversation_classifications (classified_at DESC);
GO

IF OBJECT_ID(N'dbo.conversation_sheet_exports', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_sheet_exports (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_sheet_exports_id DEFAULT NEWID(),
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    sheet_tab_name NVARCHAR(128) NOT NULL,
    sheet_row_number INT NULL,
    export_status NVARCHAR(32) NOT NULL,
    final_status NVARCHAR(64) NULL,
    idempotency_key NVARCHAR(128) NOT NULL,
    exported_at DATETIME2 NULL,
    last_sync_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_sheet_exports_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_sheet_exports_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_conversation_sheet_exports PRIMARY KEY (id),
    CONSTRAINT FK_conversation_sheet_exports_conversation
      FOREIGN KEY (conversation_id) REFERENCES dbo.conversations (id) ON DELETE CASCADE,
    CONSTRAINT UQ_conversation_sheet_exports_idempotency UNIQUE (idempotency_key)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'idx_conversation_sheet_exports_conversation'
    AND object_id = OBJECT_ID(N'dbo.conversation_sheet_exports')
)
  CREATE INDEX idx_conversation_sheet_exports_conversation
    ON dbo.conversation_sheet_exports (conversation_id, sheet_tab_name);
GO

IF OBJECT_ID(N'dbo.conversation_classification_batches', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_classification_batches (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_classification_batches_id DEFAULT NEWID(),
    batch_key NVARCHAR(128) NOT NULL,
    mode NVARCHAR(16) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    summary_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_classification_batches_created_at DEFAULT SYSUTCDATETIME(),
    completed_at DATETIME2 NULL,
    CONSTRAINT PK_conversation_classification_batches PRIMARY KEY (id),
    CONSTRAINT UQ_conversation_classification_batches_key UNIQUE (batch_key)
  );
END;
GO
