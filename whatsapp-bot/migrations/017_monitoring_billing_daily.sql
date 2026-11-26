-- DIN-430: agregados económicos diarios (estadístico, sin PII)

IF OBJECT_ID(N'dbo.monitoring_billing_daily_aggregates', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.monitoring_billing_daily_aggregates (
    day_ar CHAR(10) NOT NULL,
    inbound_count INT NOT NULL CONSTRAINT DF_monitoring_billing_inbound DEFAULT 0,
    outbound_count INT NOT NULL CONSTRAINT DF_monitoring_billing_outbound DEFAULT 0,
    outbound_bot_count INT NOT NULL CONSTRAINT DF_monitoring_billing_outbound_bot DEFAULT 0,
    outbound_agent_count INT NOT NULL CONSTRAINT DF_monitoring_billing_outbound_agent DEFAULT 0,
    free_service_count INT NULL,
    billable_service_count INT NULL,
    twilio_estimated_usd DECIMAL(18, 6) NULL,
    meta_estimated_usd DECIMAL(18, 6) NULL,
    total_estimated_usd DECIMAL(18, 6) NULL,
    twilio_confirmed_usd DECIMAL(18, 6) NULL,
    meta_confirmed_usd DECIMAL(18, 6) NULL,
    total_confirmed_usd DECIMAL(18, 6) NULL,
    currency CHAR(3) NOT NULL CONSTRAINT DF_monitoring_billing_currency DEFAULT 'USD',
    data_source NVARCHAR(32) NOT NULL,
    reconciliation_status NVARCHAR(32) NOT NULL CONSTRAINT DF_monitoring_billing_recon DEFAULT N'pending',
    created_at DATETIME2 NOT NULL CONSTRAINT DF_monitoring_billing_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_monitoring_billing_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_monitoring_billing_daily_aggregates PRIMARY KEY (day_ar)
  );
END;
GO