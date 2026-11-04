-- Reentrada posterior al cierre humano.
-- Columna nullable. Las conversaciones asignadas o en curso no se modifican.

IF COL_LENGTH('dbo.conversations', 'reentry_json') IS NULL
BEGIN
  ALTER TABLE dbo.conversations
    ADD reentry_json NVARCHAR(MAX) NULL;
END;
GO
