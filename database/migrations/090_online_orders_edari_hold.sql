-- «كاشير الطلبات»: إيصالات طلبات التطبيق لا تُرحَّل إلى الإداري تلقائياً — تنتظر «ترحيل» يدوياً.
--   ext_online_edari_holds = صف لكل إيصال بيع محجوز عن الترحيل (بمعرّف الإيصال الثابت client_receipt_id،
--   يُكتب قبل حفظ الإيصال فلا تلتقطه المزامنة في اللحظة بينهما). released_at = رُحّل يدوياً.
--   حتى الترحيل يمكن تعديل الفاتورة (أصنافها ومبلغها) ويتبعها الموقع وشركة التوصيل.
-- إضافي فقط ويُعاد تشغيله بأمان.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('dbo.ext_online_edari_holds') IS NULL
BEGIN
    CREATE TABLE dbo.ext_online_edari_holds (
        client_receipt_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ext_online_edari_holds PRIMARY KEY,
        order_id          NVARCHAR(64)  NOT NULL,
        order_number      NVARCHAR(64)  NULL,
        created_at        DATETIME2     NOT NULL CONSTRAINT DF_ext_oeh_created DEFAULT (SYSDATETIME()),
        edits             INT           NOT NULL CONSTRAINT DF_ext_oeh_edits DEFAULT (0),
        last_edit_at      DATETIME2     NULL,
        released_at       DATETIME2     NULL,
        released_by       BIGINT        NULL,
        released_by_name  NVARCHAR(120) NULL
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ext_oeh_open' AND object_id = OBJECT_ID('dbo.ext_online_edari_holds'))
    CREATE INDEX IX_ext_oeh_open ON dbo.ext_online_edari_holds (released_at) INCLUDE (order_id, order_number);
GO
