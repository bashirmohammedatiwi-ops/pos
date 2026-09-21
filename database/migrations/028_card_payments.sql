-- Card (MasterCard/Visa) payments via the local terminal service.
-- Extends the inherited reciept_credit_card table with the remaining fields the
-- terminal returns, adds the per-cashier cash box that card sales post to, and
-- stores the terminal service address per POS point (the reader is physically
-- attached to one machine).

IF COL_LENGTH('reciept_credit_card', 'card_type') IS NULL
    ALTER TABLE reciept_credit_card ADD card_type VARCHAR(50) NULL;
GO
IF COL_LENGTH('reciept_credit_card', 'auth_code') IS NULL
    ALTER TABLE reciept_credit_card ADD auth_code VARCHAR(50) NULL;
GO
IF COL_LENGTH('reciept_credit_card', 'batch_no') IS NULL
    ALTER TABLE reciept_credit_card ADD batch_no VARCHAR(50) NULL;
GO
IF COL_LENGTH('reciept_credit_card', 'ref_no') IS NULL
    ALTER TABLE reciept_credit_card ADD ref_no VARCHAR(50) NULL;
GO
IF COL_LENGTH('reciept_credit_card', 'merchant_name') IS NULL
    ALTER TABLE reciept_credit_card ADD merchant_name NVARCHAR(120) NULL;
GO
IF COL_LENGTH('reciept_credit_card', 'currency_code') IS NULL
    ALTER TABLE reciept_credit_card ADD currency_code VARCHAR(10) NULL;
GO
IF COL_LENGTH('reciept_credit_card', 'device_type') IS NULL
    ALTER TABLE reciept_credit_card ADD device_type VARCHAR(20) NULL;
GO
IF COL_LENGTH('reciept_credit_card', 'created_at') IS NULL
    ALTER TABLE reciept_credit_card ADD created_at DATETIME NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reciept_credit_card_reciept')
    CREATE INDEX IX_reciept_credit_card_reciept ON reciept_credit_card(reciept_id);
GO

-- Per-cashier cash box for card sales. NULL means "fall back to the normal box".
IF COL_LENGTH('cashiers', 'card_master_account') IS NULL
    ALTER TABLE cashiers ADD card_master_account BIGINT NULL;
GO
IF COL_LENGTH('cashiers', 'card_master_account_bank') IS NULL
    ALTER TABLE cashiers ADD card_master_account_bank INT NULL;
GO

-- Card terminal service, e.g. localhost:9092, plus the COM port it connects on.
IF COL_LENGTH('point_of_sales', 'mpos_service') IS NULL
    ALTER TABLE point_of_sales ADD mpos_service NVARCHAR(100) NULL;
GO
IF COL_LENGTH('point_of_sales', 'mpos_com_port') IS NULL
    ALTER TABLE point_of_sales ADD mpos_com_port NVARCHAR(20) NULL;
GO
