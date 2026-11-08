-- Barrera de concurrencia para la toma manual.
-- Aditiva. Las filas existentes quedan en 0.
-- Rollback de la funcionalidad: apagar MANUAL_TAKEOVER_ENABLED.
-- No dropear status_version ni conversation_operation_requests.

IF COL_LENGTH('dbo.conversations', 'status_version') IS NULL
BEGIN
  ALTER TABLE dbo.conversations
    ADD status_version INT NOT NULL
      CONSTRAINT DF_conversations_status_version DEFAULT 0;
END;
GO

IF OBJECT_ID(N'dbo.conversation_operation_requests', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.conversation_operation_requests (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_conversation_operation_requests_id DEFAULT NEWID(),
    conversation_id UNIQUEIDENTIFIER NOT NULL,
    operation NVARCHAR(64) NOT NULL,
    client_request_id NVARCHAR(80) NOT NULL,
    actor_agent_id UNIQUEIDENTIFIER NOT NULL,
    request_hash NVARCHAR(64) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_conversation_operation_requests_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_conversation_operation_requests PRIMARY KEY (id),
    CONSTRAINT UQ_conversation_operation_request UNIQUE (conversation_id, operation, client_request_id)
  );
END;
GO
