-- مردود مربوط بالفاتورة: صلاحية كاشير + ربط المردود بالفاتورة الأصلية.

USE [FOT_POS_V2];
GO

IF COL_LENGTH('cashiers_permissions', 'invoice_bound_return') IS NULL
    ALTER TABLE cashiers_permissions
        ADD invoice_bound_return BIT NOT NULL CONSTRAINT DF_cp_invoice_bound_return DEFAULT 0;
GO

IF COL_LENGTH('reciepts', 'return_of_receipt_id') IS NULL
    ALTER TABLE reciepts
        ADD return_of_receipt_id BIGINT NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_reciepts_return_of_receipt_id'
      AND object_id = OBJECT_ID('reciepts')
)
    CREATE INDEX IX_reciepts_return_of_receipt_id ON reciepts (return_of_receipt_id)
    WHERE return_of_receipt_id IS NOT NULL;
GO
