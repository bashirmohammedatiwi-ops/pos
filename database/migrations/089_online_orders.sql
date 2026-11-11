-- «كاشير الطلبات»: فوترة طلبات تطبيق ديما الحياة من نقطة البيع.
--   ext_online_order_receipts = ربط كل طلب تطبيق بإيصال المحل (بيع أو إرجاع) وما أُبلغ به الموقع.
--   ext_online_orders_settings = صف واحد (id = 1): الحسابات الآجلة، مادة أجور التوصيل، الطباعة.
--   cashiers_permissions.online_orders / online_orders_returns = صلاحيتا الكاشير (نمط 077).
-- يُعاد تشغيله بأمان: كل خطوة تفحص وجودها أولاً.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('dbo.ext_online_order_receipts') IS NULL
BEGIN
    CREATE TABLE dbo.ext_online_order_receipts (
        id                BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_online_order_receipts PRIMARY KEY,
        order_id          NVARCHAR(64)  NOT NULL,
        order_number      NVARCHAR(64)  NOT NULL,
        receipt_id        BIGINT        NOT NULL,
        receipt_number    BIGINT        NOT NULL CONSTRAINT DF_ext_oor_receipt_number DEFAULT (0),
        client_receipt_id UNIQUEIDENTIFIER NOT NULL,
        kind              NVARCHAR(10)  NOT NULL CONSTRAINT DF_ext_oor_kind DEFAULT (N'sale'),
        delivery_option   NVARCHAR(20)  NULL,
        tracking_number   NVARCHAR(80)  NULL,
        total             DECIMAL(18,2) NOT NULL CONSTRAINT DF_ext_oor_total DEFAULT (0),
        cashier_id        BIGINT        NOT NULL CONSTRAINT DF_ext_oor_cashier DEFAULT (0),
        created_at        DATETIME2     NOT NULL CONSTRAINT DF_ext_oor_created DEFAULT (SYSDATETIME()),
        reported_ok       BIT           NOT NULL CONSTRAINT DF_ext_oor_reported DEFAULT (0),
        reported_at       DATETIME2     NULL,
        last_error        NVARCHAR(400) NULL,
        CONSTRAINT CK_ext_oor_kind CHECK (kind IN (N'sale', N'return'))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ext_oor_order_kind' AND object_id = OBJECT_ID('dbo.ext_online_order_receipts'))
    CREATE UNIQUE INDEX UX_ext_oor_order_kind ON dbo.ext_online_order_receipts (order_id, kind);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ext_oor_receipt' AND object_id = OBJECT_ID('dbo.ext_online_order_receipts'))
    CREATE INDEX IX_ext_oor_receipt ON dbo.ext_online_order_receipts (receipt_id) INCLUDE (order_number, kind);
GO

IF OBJECT_ID('dbo.ext_online_orders_settings') IS NULL
BEGIN
    CREATE TABLE dbo.ext_online_orders_settings (
        id                     INT NOT NULL CONSTRAINT PK_ext_online_orders_settings PRIMARY KEY,
        enabled                BIT NOT NULL CONSTRAINT DF_ext_oos_enabled DEFAULT (0),
        -- حسابات الإداري (Seq) التي تُقيَّد عليها الفاتورة آجلاً
        hi_express_account     BIGINT NULL,
        hi_express_account_num NVARCHAR(60)  NULL,
        hi_express_account_name NVARCHAR(200) NULL,
        prepaid_account        BIGINT NULL,
        prepaid_account_num    NVARCHAR(60)  NULL,
        prepaid_account_name   NVARCHAR(200) NULL,
        -- مادة خدمية في الكتالوج تحمل أجور التوصيل + التغليف
        delivery_article_id    BIGINT NULL,
        delivery_article_name  NVARCHAR(200) NULL,
        receipt_copies         INT NOT NULL CONSTRAINT DF_ext_oos_receipt_copies DEFAULT (1),
        invoice_copies         INT NOT NULL CONSTRAINT DF_ext_oos_invoice_copies DEFAULT (1),
        label_copies           INT NOT NULL CONSTRAINT DF_ext_oos_label_copies DEFAULT (1),
        label_printer_name     NVARCHAR(200) NULL,
        auto_print_new_slips   BIT NOT NULL CONSTRAINT DF_ext_oos_auto_slips DEFAULT (0),
        double_check           BIT NOT NULL CONSTRAINT DF_ext_oos_double_check DEFAULT (0),
        updated_at             DATETIME2 NULL,
        CONSTRAINT CK_ext_oos_singleton CHECK (id = 1)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.ext_online_orders_settings WHERE id = 1)
    INSERT INTO dbo.ext_online_orders_settings (id) VALUES (1);
GO

IF COL_LENGTH('cashiers_permissions', 'online_orders') IS NULL
    ALTER TABLE cashiers_permissions
        ADD online_orders BIT NOT NULL CONSTRAINT DF_cp_online_orders DEFAULT 0;
GO

IF COL_LENGTH('cashiers_permissions', 'online_orders_returns') IS NULL
    ALTER TABLE cashiers_permissions
        ADD online_orders_returns BIT NOT NULL CONSTRAINT DF_cp_online_orders_returns DEFAULT 0;
GO
