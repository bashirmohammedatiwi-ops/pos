-- POS activity audit log enhancements (FOT_POS_V2 only)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('ext_pos_logs') AND name = 'cashier_id')
ALTER TABLE ext_pos_logs ADD
    cashier_id   BIGINT NULL,
    pos_id       BIGINT NULL,
    receipt_id   BIGINT NULL,
    receipt_num  NVARCHAR(30) NULL,
    event_type   NVARCHAR(50) NULL;
GO

PRINT 'FOT_POS_V2 activity log columns ready.';
GO
