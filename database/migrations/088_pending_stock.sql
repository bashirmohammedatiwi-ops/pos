-- المخزون الحيّ: عدد الإداري (CurTot1) لا ينقص إلا بعد «دمج الإيصالات»، فيُطرح منه ما بيع ولم يُدمج بعد.
--   articles.ext_pending_qty = مبيعات + هدايا − مرتجعات لم تُدمج (+ حجوزات فواتير التحويل اليدوي المؤجلة).
--   المعروض في كل مكان = CurTot1 − ext_pending_qty.
-- الإيصال «يُسوّى» (stock_settled_at) حين يجد السيرفر فاتورته في الإداري مغلقة (FilePOS5.Closed = True).
-- لا triggers هنا إطلاقاً (انظر 087).
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.reciepts', 'stock_settled_at') IS NULL
    ALTER TABLE dbo.reciepts ADD stock_settled_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.reciepts', 'stock_settle_source') IS NULL
    ALTER TABLE dbo.reciepts ADD stock_settle_source NVARCHAR(20) NULL;
GO

-- خط الأساس عند التثبيت:
--   الأقدم من 3 أيام: مُسوّى (baseline).
--   الأحدث والمرسل للإداري: «verify» — يُعامل كمسوّى (لا يُطرح، فلا ينخفض العدد لحظة التثبيت)
--   حتى يفحصه السيرفر في الإداري: المغلق يبقى مسوّى، والمفتوح يعود معلّقاً ويُطرح.
--   الأحدث وغير المرسل بعد: معلّق من الآن.
UPDATE dbo.reciepts
SET stock_settled_at = SYSDATETIME(), stock_settle_source = N'baseline'
WHERE stock_settled_at IS NULL AND stock_settle_source IS NULL
  AND creation_date < DATEADD(HOUR, -72, GETDATE());
GO
UPDATE dbo.reciepts
SET stock_settled_at = SYSDATETIME(), stock_settle_source = N'verify'
WHERE stock_settled_at IS NULL AND stock_settle_source IS NULL
  AND synced = 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reciepts_stock_settle' AND object_id = OBJECT_ID('dbo.reciepts'))
    CREATE INDEX IX_reciepts_stock_settle ON dbo.reciepts (stock_settled_at, id)
        INCLUDE (kind, is_pending, synced, creation_date, point_of_sale_id, client_receipt_id);
GO

IF COL_LENGTH('dbo.articles', 'ext_pending_qty') IS NULL
    ALTER TABLE dbo.articles ADD ext_pending_qty FLOAT NOT NULL
        CONSTRAINT DF_articles_ext_pending_qty DEFAULT (0);
GO

-- فواتير «التحويل اليدوي» تبقى على جهاز الكاشير حتى يُضغط «تحويل»؛ الكاشير يرسل لقطة منها
-- فتُطرح من العدد إلى أن تصل الفاتورة نفسها (بنفس client_receipt_id).
IF OBJECT_ID('dbo.ext_stock_holds') IS NULL
BEGIN
    CREATE TABLE dbo.ext_stock_holds (
        id                BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_stock_holds PRIMARY KEY,
        pos_id            BIGINT NOT NULL,
        client_receipt_id UNIQUEIDENTIFIER NOT NULL,
        article_id        BIGINT NOT NULL,
        quantity          FLOAT NOT NULL,
        kind              INT NOT NULL CONSTRAINT DF_ext_stock_holds_kind DEFAULT (0),
        sold_at           DATETIME2 NULL,
        reported_at       DATETIME2 NOT NULL CONSTRAINT DF_ext_stock_holds_reported DEFAULT (SYSDATETIME())
    );
    CREATE INDEX IX_ext_stock_holds_pos ON dbo.ext_stock_holds (pos_id);
    CREATE INDEX IX_ext_stock_holds_article ON dbo.ext_stock_holds (article_id) INCLUDE (quantity, kind, client_receipt_id, reported_at);
END
GO

IF COL_LENGTH('dbo.ext_edari_settings', 'pending_stock_enabled') IS NULL
    ALTER TABLE dbo.ext_edari_settings ADD pending_stock_enabled BIT NOT NULL
        CONSTRAINT DF_ext_edari_settings_pending_stock_enabled DEFAULT (1);
GO
IF COL_LENGTH('dbo.ext_edari_settings', 'pending_stock_max_hours') IS NULL
    ALTER TABLE dbo.ext_edari_settings ADD pending_stock_max_hours INT NOT NULL
        CONSTRAINT DF_ext_edari_settings_pending_stock_max_hours DEFAULT (72);
GO
IF COL_LENGTH('dbo.ext_edari_settings', 'pending_stock_last_check_at') IS NULL
    ALTER TABLE dbo.ext_edari_settings ADD pending_stock_last_check_at DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.ext_edari_settings', 'pending_stock_last_message') IS NULL
    ALTER TABLE dbo.ext_edari_settings ADD pending_stock_last_message NVARCHAR(400) NULL;
GO
