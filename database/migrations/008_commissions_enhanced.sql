-- Enhanced commissions: per-salesman rules, labels, employee currency profiles
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_rules') AND name = 'salesman_id')
    ALTER TABLE ext_commission_rules ADD salesman_id BIGINT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_rules') AND name = 'label')
    ALTER TABLE ext_commission_rules ADD label NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_salesman_commission_profiles')
CREATE TABLE ext_salesman_commission_profiles (
    salesman_id         BIGINT NOT NULL PRIMARY KEY,
    currency_code       NVARCHAR(10) NOT NULL CONSTRAINT DF_ext_sm_comm_currency DEFAULT N'IQD',
    opening_balance     DECIMAL(18,4) NOT NULL CONSTRAINT DF_ext_sm_comm_open DEFAULT 0,
    paid_out_total      DECIMAL(18,4) NOT NULL CONSTRAINT DF_ext_sm_comm_paid DEFAULT 0,
    notes               NVARCHAR(500) NULL,
    updated_at          DATETIME2 NOT NULL CONSTRAINT DF_ext_sm_comm_upd DEFAULT GETDATE()
);
GO

PRINT 'FOT_POS_V2 commission enhancements ready.';
GO
