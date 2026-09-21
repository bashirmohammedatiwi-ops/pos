-- Align ext_commission_calculations with current app schema (legacy table used product_id/sale_amount)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'article_id')
    ALTER TABLE ext_commission_calculations ADD article_id BIGINT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'product_id')
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'article_id')
    UPDATE ext_commission_calculations
    SET article_id = product_id
    WHERE article_id IS NULL AND product_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'commission_type')
    ALTER TABLE ext_commission_calculations ADD commission_type NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'commission_value')
    ALTER TABLE ext_commission_calculations ADD commission_value DECIMAL(18,4) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'quantity')
    ALTER TABLE ext_commission_calculations ADD quantity DECIMAL(18,4) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'line_amount')
    ALTER TABLE ext_commission_calculations ADD line_amount DECIMAL(18,4) NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'sale_amount')
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'line_amount')
    UPDATE ext_commission_calculations
    SET line_amount = sale_amount
    WHERE line_amount IS NULL AND sale_amount IS NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'article_id')
    UPDATE ext_commission_calculations SET article_id = 0 WHERE article_id IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'commission_type')
    UPDATE ext_commission_calculations SET commission_type = N'fixed' WHERE commission_type IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'commission_value')
    UPDATE ext_commission_calculations SET commission_value = 0 WHERE commission_value IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'quantity')
    UPDATE ext_commission_calculations SET quantity = 1 WHERE quantity IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'line_amount')
    UPDATE ext_commission_calculations
    SET line_amount = COALESCE(line_amount, commission_amount, 0)
    WHERE line_amount IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'product_id')
   AND NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('ext_commission_calculations') AND COL_NAME(parent_object_id, parent_column_id) = 'product_id')
    ALTER TABLE ext_commission_calculations ADD CONSTRAINT DF_ext_comm_calc_product_id DEFAULT 0 FOR product_id;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'sale_amount')
   AND NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('ext_commission_calculations') AND COL_NAME(parent_object_id, parent_column_id) = 'sale_amount')
    ALTER TABLE ext_commission_calculations ADD CONSTRAINT DF_ext_comm_calc_sale_amount DEFAULT 0 FOR sale_amount;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'period_year')
   AND NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('ext_commission_calculations') AND COL_NAME(parent_object_id, parent_column_id) = 'period_year')
    ALTER TABLE ext_commission_calculations ADD CONSTRAINT DF_ext_comm_calc_period_year DEFAULT YEAR(GETDATE()) FOR period_year;
GO

PRINT 'FOT_POS_V2 commission calculations schema aligned.';
GO
