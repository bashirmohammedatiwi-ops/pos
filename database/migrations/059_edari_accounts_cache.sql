-- ذاكرة محلية لحسابات الإداري (File11n) حتى تظهر الصناديق الجديدة فوراً في لوحة التحكم.
-- كانت قائمة الصناديق تُقرأ حياً من NexusDB عند كل بحث، وموفّر ADO يفسد الأسماء العربية
-- (كل حرف عربي يعود U+FFFD)، فأي صندوق يُضاف في الإداري ولا يوجد في HAYAT2025 لا يُعرَف
-- بالاسم ولا يُعثر عليه بالبحث العربي. الأسماء هنا تأتي من قناة nxServer التي تُعيد بايتات
-- UTF-8 سليمة، وتُخزَّن ليعمل البحث بالعربية والرقم فوراً وبدون اتصال بالإداري.

USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_edari_accounts')
CREATE TABLE ext_edari_accounts (
    edari_seq       BIGINT NOT NULL PRIMARY KEY,
    account_num     NVARCHAR(60) NULL,
    account_name    NVARCHAR(300) NULL,
    group_num       NVARCHAR(60) NULL,
    group_name      NVARCHAR(300) NULL,
    is_cashbox      BIT NOT NULL CONSTRAINT DF_eea_is_cashbox DEFAULT (0),
    closed          BIT NOT NULL CONSTRAINT DF_eea_closed DEFAULT (0),
    balance         DECIMAL(19, 4) NOT NULL CONSTRAINT DF_eea_balance DEFAULT (0),
    sort_order      INT NOT NULL CONSTRAINT DF_eea_sort DEFAULT (0),
    updated_at      DATETIME2 NOT NULL CONSTRAINT DF_eea_updated DEFAULT (SYSUTCDATETIME())
);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ext_edari_accounts_num')
    CREATE INDEX IX_ext_edari_accounts_num ON ext_edari_accounts(account_num);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ext_edari_accounts_cashbox')
    CREATE INDEX IX_ext_edari_accounts_cashbox ON ext_edari_accounts(is_cashbox, sort_order, account_num);
GO
