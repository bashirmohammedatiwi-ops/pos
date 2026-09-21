-- Per-line salesman attribution for commissions/targets (internal; Edari bill stays without salesman)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reciept_items') AND name = 'salesman_id')
    ALTER TABLE reciept_items ADD salesman_id BIGINT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reciept_items') AND name = 'salesman_name')
    ALTER TABLE reciept_items ADD salesman_name NVARCHAR(200) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reciept_items') AND name = 'group_key')
    ALTER TABLE reciept_items ADD group_key INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reciept_items') AND name = 'group_label')
    ALTER TABLE reciept_items ADD group_label NVARCHAR(100) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reciept_items_salesman' AND object_id = OBJECT_ID('reciept_items'))
    CREATE INDEX IX_reciept_items_salesman ON reciept_items(salesman_id) WHERE salesman_id IS NOT NULL;
GO

PRINT 'Line salesman attribution columns ready.';
GO
