SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() <> N'FOT_POS_V2'
BEGIN
    RAISERROR(N'Refused: connected database is not FOT_POS_V2', 16, 1);
    RETURN;
END

DECLARE @keep TABLE (name sysname PRIMARY KEY);
INSERT INTO @keep (name) VALUES
    (N'schema_migrations'),
    (N'sysdiagrams'),
    (N'ext_users'),
    (N'admin_users'),
    (N'ext_edari_settings'),
    (N'ext_business_period_settings'),
    (N'ext_pos_cashbox_settings'),
    (N'print_options'),
    (N'currencies'),
    (N'server_settings'),
    (N'ext_cloud_settings'),
    (N'ext_weekly_settlement_settings');

DECLARE @fk nvarchar(max) = N'';
SELECT @fk += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
    + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id))
    + N' NOCHECK CONSTRAINT ' + QUOTENAME(name) + N';' + CHAR(10)
FROM sys.foreign_keys;
IF LEN(@fk) > 0 EXEC sp_executesql @fk;

DECLARE @name sysname, @sql nvarchar(max);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT t.name
    FROM sys.tables t
    WHERE t.is_ms_shipped = 0
      AND SCHEMA_NAME(t.schema_id) = N'dbo'
      AND t.name NOT IN (SELECT name FROM @keep)
    ORDER BY t.name;

OPEN c;
FETCH NEXT FROM c INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@name) + N';';
    EXEC sp_executesql @sql;

    IF EXISTS (
        SELECT 1 FROM sys.identity_columns
        WHERE object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@name))
    )
    BEGIN
        SET @sql = N'DBCC CHECKIDENT (N''dbo.' + REPLACE(@name, '''', '''''') + N''', RESEED, 0) WITH NO_INFOMSGS;';
        EXEC sp_executesql @sql;
    END

    FETCH NEXT FROM c INTO @name;
END
CLOSE c;
DEALLOCATE c;

UPDATE dbo.ext_edari_settings
SET last_receipt_sync_at = NULL,
    last_catalog_sync_at = NULL,
    last_connection_test_at = NULL,
    last_connection_ok = NULL,
    last_connection_message = NULL,
    updated_at = GETDATE();

UPDATE dbo.ext_pos_cashbox_settings
SET qi_master_account = NULL,
    qi_master_account_bank = NULL,
    gift_master_account = NULL,
    gift_master_account_bank = NULL,
    edari_gift_account = 0,
    updated_at = GETDATE();

SET @fk = N'';
SELECT @fk += N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id))
    + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id))
    + N' WITH CHECK CHECK CONSTRAINT ' + QUOTENAME(name) + N';' + CHAR(10)
FROM sys.foreign_keys;
IF LEN(@fk) > 0 EXEC sp_executesql @fk;

PRINT N'Wipe complete.';
