-- Global POS cash box routing for QI card payments and gift receipts.
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_pos_cashbox_settings')
CREATE TABLE ext_pos_cashbox_settings (
    id                      INT NOT NULL PRIMARY KEY DEFAULT 1,
    qi_master_account       BIGINT NULL,
    qi_master_account_bank  INT NULL,
    gift_master_account     BIGINT NULL,
    gift_master_account_bank INT NULL,
    updated_at              DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CK_ext_pos_cashbox_settings_singleton CHECK (id = 1)
);
GO

IF NOT EXISTS (SELECT 1 FROM ext_pos_cashbox_settings WHERE id = 1)
    INSERT INTO ext_pos_cashbox_settings (id) VALUES (1);
GO

PRINT 'ext_pos_cashbox_settings ready.';
GO
