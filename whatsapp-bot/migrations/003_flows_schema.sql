-- Phase 5: flow definitions in SQL Server (JSON snapshots + normalized nodes/transitions)

IF OBJECT_ID(N'dbo.flows', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.flows (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_flows_id DEFAULT NEWID(),
    flow_key NVARCHAR(100) NOT NULL,
    name NVARCHAR(255) NOT NULL,
    description NVARCHAR(MAX) NULL,
    status NVARCHAR(30) NOT NULL CONSTRAINT DF_flows_status DEFAULT N'active',
    created_at DATETIME2 NOT NULL CONSTRAINT DF_flows_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_flows_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_flows PRIMARY KEY (id),
    CONSTRAINT UQ_flows_flow_key UNIQUE (flow_key)
  );
END;
GO

IF OBJECT_ID(N'dbo.flow_versions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.flow_versions (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_flow_versions_id DEFAULT NEWID(),
    flow_id UNIQUEIDENTIFIER NOT NULL,
    version_number INT NOT NULL,
    version_label NVARCHAR(50) NULL,
    status NVARCHAR(30) NOT NULL,
    entry_node_key NVARCHAR(100) NOT NULL,
    fallback_node_key NVARCHAR(100) NULL,
    created_by UNIQUEIDENTIFIER NULL,
    published_by UNIQUEIDENTIFIER NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_flow_versions_created_at DEFAULT SYSUTCDATETIME(),
    published_at DATETIME2 NULL,
    archived_at DATETIME2 NULL,
    metadata_json NVARCHAR(MAX) NULL,
    CONSTRAINT PK_flow_versions PRIMARY KEY (id),
    CONSTRAINT FK_flow_versions_flow FOREIGN KEY (flow_id) REFERENCES dbo.flows (id) ON DELETE CASCADE,
    CONSTRAINT UQ_flow_versions_flow_version UNIQUE (flow_id, version_number)
  );
END;
GO

IF OBJECT_ID(N'dbo.flow_nodes', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.flow_nodes (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_flow_nodes_id DEFAULT NEWID(),
    flow_version_id UNIQUEIDENTIFIER NOT NULL,
    node_key NVARCHAR(100) NOT NULL,
    type NVARCHAR(50) NOT NULL,
    message NVARCHAR(MAX) NULL,
    title NVARCHAR(255) NULL,
    metadata_json NVARCHAR(MAX) NULL,
    position_x INT NULL,
    position_y INT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_flow_nodes_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_flow_nodes_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_flow_nodes PRIMARY KEY (id),
    CONSTRAINT FK_flow_nodes_version FOREIGN KEY (flow_version_id) REFERENCES dbo.flow_versions (id) ON DELETE CASCADE,
    CONSTRAINT UQ_flow_nodes_version_key UNIQUE (flow_version_id, node_key)
  );
END;
GO

IF OBJECT_ID(N'dbo.flow_transitions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.flow_transitions (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_flow_transitions_id DEFAULT NEWID(),
    flow_node_id UNIQUEIDENTIFIER NOT NULL,
    type NVARCHAR(50) NOT NULL,
    value_json NVARCHAR(MAX) NULL,
    next_node_key NVARCHAR(100) NOT NULL,
    priority INT NOT NULL CONSTRAINT DF_flow_transitions_priority DEFAULT 0,
    metadata_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_flow_transitions_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_flow_transitions PRIMARY KEY (id),
    CONSTRAINT FK_flow_transitions_node FOREIGN KEY (flow_node_id) REFERENCES dbo.flow_nodes (id) ON DELETE CASCADE
  );
END;
GO

IF OBJECT_ID(N'dbo.flow_version_snapshots', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.flow_version_snapshots (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_flow_version_snapshots_id DEFAULT NEWID(),
    flow_version_id UNIQUEIDENTIFIER NOT NULL,
    snapshot_json NVARCHAR(MAX) NOT NULL,
    checksum NVARCHAR(128) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_flow_version_snapshots_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_flow_version_snapshots PRIMARY KEY (id),
    CONSTRAINT FK_flow_version_snapshots_version FOREIGN KEY (flow_version_id) REFERENCES dbo.flow_versions (id) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_flow_versions_flow_status' AND object_id = OBJECT_ID(N'dbo.flow_versions'))
  CREATE INDEX idx_flow_versions_flow_status ON dbo.flow_versions (flow_id, status);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_flow_versions_flow_version_number' AND object_id = OBJECT_ID(N'dbo.flow_versions'))
  CREATE INDEX idx_flow_versions_flow_version_number ON dbo.flow_versions (flow_id, version_number);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_flow_nodes_version_key' AND object_id = OBJECT_ID(N'dbo.flow_nodes'))
  CREATE INDEX idx_flow_nodes_version_key ON dbo.flow_nodes (flow_version_id, node_key);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_flow_transitions_node' AND object_id = OBJECT_ID(N'dbo.flow_transitions'))
  CREATE INDEX idx_flow_transitions_node ON dbo.flow_transitions (flow_node_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_flow_version_snapshots_version' AND object_id = OBJECT_ID(N'dbo.flow_version_snapshots'))
  CREATE INDEX idx_flow_version_snapshots_version ON dbo.flow_version_snapshots (flow_version_id);
GO
