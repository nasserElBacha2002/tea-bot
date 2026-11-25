-- Durable queue for physical media deletes after SQL retention commit.
-- Forward-only; no change to retention policy.

IF OBJECT_ID(N'dbo.retention_pending_storage_deletes', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.retention_pending_storage_deletes (
    storage_key NVARCHAR(512) NOT NULL,
    enqueued_at DATETIME2 NOT NULL CONSTRAINT DF_retention_pending_storage_enqueued DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_retention_pending_storage_deletes PRIMARY KEY (storage_key)
  );
END;
GO