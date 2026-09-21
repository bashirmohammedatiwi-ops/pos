-- تتبع أخطاء الواجهات (لوحة التحكم + نقاط البيع) لتشخيص أي مشكلة ميدانية
USE [FOT_POS_V2];
GO

IF OBJECT_ID('ext_client_errors', 'U') IS NULL
BEGIN
    CREATE TABLE ext_client_errors (
        id BIGINT IDENTITY(1,1) PRIMARY KEY,
        source NVARCHAR(10) NOT NULL,              -- admin | pos
        terminal NVARCHAR(100) NULL,               -- اسم/معرّف نقطة البيع إن وجد
        message NVARCHAR(2000) NOT NULL,
        stack NVARCHAR(MAX) NULL,
        context NVARCHAR(MAX) NULL,                -- JSON: صفحة، إصدار، حالة
        app_version NVARCHAR(50) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_ext_client_errors_created_at DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ext_client_errors_created' AND object_id = OBJECT_ID('ext_client_errors')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_ext_client_errors_created
        ON ext_client_errors (created_at DESC, source);
END
GO
