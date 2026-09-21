-- Idempotent receipt sync from POS offline queue (FOT_POS_V2)
IF COL_LENGTH('reciepts', 'client_receipt_id') IS NULL
    ALTER TABLE reciepts ADD client_receipt_id UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_reciepts_client_receipt_id' AND object_id = OBJECT_ID('reciepts'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_reciepts_client_receipt_id
        ON reciepts(client_receipt_id)
        WHERE client_receipt_id IS NOT NULL;
END
GO
