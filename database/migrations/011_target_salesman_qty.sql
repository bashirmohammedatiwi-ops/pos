-- Per-salesman quantity targets (daily / weekly / monthly)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('ext_target_assignments') AND name = 'daily_target'
)
ALTER TABLE ext_target_assignments ADD
    daily_target   DECIMAL(18,4) NULL,
    weekly_target  DECIMAL(18,4) NULL,
    monthly_target DECIMAL(18,4) NULL;
GO

PRINT 'FOT_POS_V2 target assignment periods ready.';
GO
