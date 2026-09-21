-- نطاق الكاشير: مندوبون مسموحون، حسابات آجل، وتطبيق العمولات/الأهداف
USE [FOT_POS_V2];
GO

IF COL_LENGTH('cashiers', 'apply_commissions') IS NULL
    ALTER TABLE cashiers ADD apply_commissions BIT NOT NULL CONSTRAINT DF_cashiers_apply_commissions DEFAULT 1;
GO

IF COL_LENGTH('cashiers', 'apply_targets') IS NULL
    ALTER TABLE cashiers ADD apply_targets BIT NOT NULL CONSTRAINT DF_cashiers_apply_targets DEFAULT 1;
GO

IF OBJECT_ID('cashier_salesmen', 'U') IS NULL
BEGIN
    CREATE TABLE cashier_salesmen (
        cashier_id  BIGINT NOT NULL,
        salesman_id BIGINT NOT NULL,
        CONSTRAINT PK_cashier_salesmen PRIMARY KEY (cashier_id, salesman_id),
        CONSTRAINT FK_cashier_salesmen_cashier FOREIGN KEY (cashier_id) REFERENCES cashiers (id) ON DELETE CASCADE
    );
    CREATE NONCLUSTERED INDEX IX_cashier_salesmen_salesman ON cashier_salesmen (salesman_id);
END
GO

IF OBJECT_ID('cashier_credit_accounts', 'U') IS NULL
BEGIN
    CREATE TABLE cashier_credit_accounts (
        cashier_id   BIGINT NOT NULL,
        edari_seq    BIGINT NOT NULL,
        account_num  NVARCHAR(50) NULL,
        account_name NVARCHAR(300) NOT NULL,
        sort_order   INT NOT NULL CONSTRAINT DF_cca_sort DEFAULT 0,
        CONSTRAINT PK_cashier_credit_accounts PRIMARY KEY (cashier_id, edari_seq),
        CONSTRAINT FK_cashier_credit_accounts_cashier FOREIGN KEY (cashier_id) REFERENCES cashiers (id) ON DELETE CASCADE
    );
    CREATE NONCLUSTERED INDEX IX_cashier_credit_accounts_seq ON cashier_credit_accounts (edari_seq);
END
GO
