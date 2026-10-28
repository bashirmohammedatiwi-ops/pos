-- بوابة الـ API الشبكية (Network API Platform): مفاتيح الوصول والويب هوك للتكامل مع أي تطبيق على الشبكة
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_api_keys')
BEGIN
    CREATE TABLE dbo.ext_api_keys (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_api_keys PRIMARY KEY,
        name            NVARCHAR(200) NOT NULL,
        key_prefix      NVARCHAR(32) NOT NULL,
        key_hash        NVARCHAR(128) NOT NULL,
        scopes          NVARCHAR(1000) NOT NULL CONSTRAINT DF_ext_api_keys_scopes DEFAULT N'*',
        role_name       NVARCHAR(50) NOT NULL CONSTRAINT DF_ext_api_keys_role DEFAULT N'admin',
        notes           NVARCHAR(500) NULL,
        is_active       BIT NOT NULL CONSTRAINT DF_ext_api_keys_active DEFAULT 1,
        request_count   BIGINT NOT NULL CONSTRAINT DF_ext_api_keys_req_count DEFAULT 0,
        last_used_at    DATETIME2 NULL,
        last_used_ip    NVARCHAR(64) NULL,
        expires_at      DATETIME2 NULL,
        created_at      DATETIME2 NOT NULL CONSTRAINT DF_ext_api_keys_created DEFAULT GETDATE()
    );
    CREATE UNIQUE INDEX IX_ext_api_keys_hash ON dbo.ext_api_keys(key_hash);
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_api_webhooks')
BEGIN
    CREATE TABLE dbo.ext_api_webhooks (
        id                  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_api_webhooks PRIMARY KEY,
        name                NVARCHAR(200) NOT NULL,
        target_url          NVARCHAR(1000) NOT NULL,
        secret              NVARCHAR(128) NULL,
        events              NVARCHAR(500) NOT NULL CONSTRAINT DF_ext_api_webhooks_events DEFAULT N'*',
        is_active           BIT NOT NULL CONSTRAINT DF_ext_api_webhooks_active DEFAULT 1,
        delivery_count      BIGINT NOT NULL CONSTRAINT DF_ext_api_webhooks_deliveries DEFAULT 0,
        failure_count       BIGINT NOT NULL CONSTRAINT DF_ext_api_webhooks_failures DEFAULT 0,
        last_status_code    INT NULL,
        last_error          NVARCHAR(500) NULL,
        last_triggered_at   DATETIME2 NULL,
        created_at          DATETIME2 NOT NULL CONSTRAINT DF_ext_api_webhooks_created DEFAULT GETDATE()
    );
END
GO
