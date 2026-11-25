-- DIN-432 CR3: lease y generación en conversation_sheet_sync_jobs; estado RAW en export ledger

IF COL_LENGTH('dbo.conversation_sheet_sync_jobs', 'worker_owner') IS NULL
BEGIN
  ALTER TABLE dbo.conversation_sheet_sync_jobs
    ADD worker_owner NVARCHAR(128) NULL,
        worker_lease_until DATETIME2 NULL,
        job_generation INT NOT NULL CONSTRAINT DF_conversation_sheet_sync_jobs_generation DEFAULT 0;
END;
GO

IF COL_LENGTH('dbo.conversation_sheet_exports', 'raw_export_status') IS NULL
BEGIN
  ALTER TABLE dbo.conversation_sheet_exports
    ADD raw_export_status NVARCHAR(32) NULL,
        raw_export_key NVARCHAR(128) NULL;
END;
GO