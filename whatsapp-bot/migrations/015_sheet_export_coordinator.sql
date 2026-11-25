-- DIN-432 CR2-001 / CR2-003: coordinación durable de export y cola de sync pendiente

IF COL_LENGTH('dbo.conversation_sheet_exports', 'coordinator_state') IS NULL
BEGIN
  ALTER TABLE dbo.conversation_sheet_exports
    ADD coordinator_state NVARCHAR(32) NULL,
        coordinator_owner NVARCHAR(128) NULL,
        coordinator_lease_until DATETIME2 NULL;
END;
GO

-- Una fila ledger por conversación y pestaña (destino físico único)
;WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY conversation_id, sheet_tab_name
           ORDER BY
             CASE WHEN sheet_row_number IS NOT NULL THEN 0 ELSE 1 END,
             exported_at DESC,
             created_at DESC
         ) AS rn
  FROM dbo.conversation_sheet_exports
)
DELETE e
FROM dbo.conversation_sheet_exports AS e
INNER JOIN ranked AS r ON r.id = e.id
WHERE r.rn > 1;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'UQ_conversation_sheet_exports_conversation_tab'
    AND object_id = OBJECT_ID(N'dbo.conversation_sheet_exports')
)
  CREATE UNIQUE INDEX UQ_conversation_sheet_exports_conversation_tab
    ON dbo.conversation_sheet_exports (conversation_id, sheet_tab_name);
GO

IF OBJECT_ID(N'dbo.conversation_sheet_sync_jobs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_sheet_sync_jobs (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_sheet_sync_jobs_id DEFAULT NEWID(),
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    sync_kind NVARCHAR(32) NOT NULL,
    status NVARCHAR(32) NOT NULL,
    attempts INT NOT NULL CONSTRAINT DF_conversation_sheet_sync_jobs_attempts DEFAULT 0,
    next_attempt_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_sheet_sync_jobs_next_attempt DEFAULT SYSUTCDATETIME(),
    last_error NVARCHAR(512) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_sheet_sync_jobs_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_sheet_sync_jobs_updated DEFAULT SYSUTCDATETIME(),
  payload_hash NVARCHAR(64) NULL,
    CONSTRAINT PK_conversation_sheet_sync_jobs PRIMARY KEY (id),
    CONSTRAINT FK_conversation_sheet_sync_jobs_conversation
      FOREIGN KEY (conversation_id) REFERENCES dbo.conversations (id) ON DELETE CASCADE,
    CONSTRAINT UQ_conversation_sheet_sync_jobs_kind
      UNIQUE (conversation_id, sync_kind)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'idx_conversation_sheet_sync_jobs_due'
    AND object_id = OBJECT_ID(N'dbo.conversation_sheet_sync_jobs')
)
  CREATE INDEX idx_conversation_sheet_sync_jobs_due
    ON dbo.conversation_sheet_sync_jobs (status, next_attempt_at);
GO