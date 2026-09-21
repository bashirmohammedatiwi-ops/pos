-- إصدار كتالوج دائم: لا يعود للصفر مع إعادة تشغيل الخادم، ويُسجَّل سبب كل تغيير
USE [FOT_POS_V2];
GO

IF OBJECT_ID('ext_catalog_version', 'U') IS NULL
BEGIN
    CREATE TABLE ext_catalog_version (
        id BIGINT IDENTITY(1,1) PRIMARY KEY,
        scope NVARCHAR(20) NOT NULL CONSTRAINT DF_catver_scope DEFAULT 'all',
        created_at DATETIME2 NOT NULL CONSTRAINT DF_catver_created DEFAULT GETDATE()
    );
END
GO

-- آخر إصدار كتالوج تعمل عليه كل نقطة بيع (يُحدث عبر heartbeat)
IF COL_LENGTH('point_of_sales', 'catalog_version') IS NULL
    ALTER TABLE point_of_sales ADD catalog_version BIGINT NULL;
GO

-- آخر علامة مائية (Seq) وصلتها كل نقطة بيع من مزامنة الكتالوج
IF COL_LENGTH('point_of_sales', 'catalog_seq') IS NULL
    ALTER TABLE point_of_sales ADD catalog_seq BIGINT NULL;
GO
