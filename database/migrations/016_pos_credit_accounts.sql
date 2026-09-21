-- حسابات آجلة مختارة من Edari للظهور في نقطة البيع
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_pos_credit_accounts')
CREATE TABLE ext_pos_credit_accounts (
    edari_seq       BIGINT NOT NULL PRIMARY KEY,
    account_num     NVARCHAR(50) NULL,
    account_name    NVARCHAR(300) NOT NULL,
    sort_order      INT NOT NULL DEFAULT 0,
    added_at        DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO
