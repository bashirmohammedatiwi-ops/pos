IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.schema_migrations (
        version INT NOT NULL CONSTRAINT PK_schema_migrations PRIMARY KEY,
        name NVARCHAR(260) NOT NULL,
        applied_at DATETIME2 NOT NULL CONSTRAINT DF_schema_migrations_applied DEFAULT SYSUTCDATETIME()
    );
END
GO
