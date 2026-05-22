-- Phase 6: audit trail for flow management

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.audit_logs (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_audit_logs_id DEFAULT NEWID(),
    actor_user_id UNIQUEIDENTIFIER NULL,
    entity_type NVARCHAR(64) NOT NULL,
    entity_id NVARCHAR(128) NOT NULL,
    action NVARCHAR(64) NOT NULL,
    before_json NVARCHAR(MAX) NULL,
    after_json NVARCHAR(MAX) NULL,
    metadata_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_audit_logs_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_audit_logs PRIMARY KEY (id)
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_audit_logs_entity' AND object_id = OBJECT_ID(N'dbo.audit_logs'))
  CREATE INDEX idx_audit_logs_entity ON dbo.audit_logs (entity_type, entity_id, created_at DESC);
GO
