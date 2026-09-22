-- الرقم الذي طُبع على الورق عندما أعاد الخادم ترقيم الفاتورة.
-- المرتجع يبحث بالرقم الرسمي أو بهذا الرقم حتى لا يُفتح بيع قديم بالخطأ.
IF COL_LENGTH(N'dbo.reciepts', N'printed_number') IS NULL
BEGIN
    ALTER TABLE dbo.reciepts ADD printed_number BIGINT NULL;
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_reciepts_printed_number' AND object_id = OBJECT_ID(N'dbo.reciepts')
)
BEGIN
    CREATE INDEX IX_reciepts_printed_number
        ON dbo.reciepts (printed_number)
        WHERE printed_number IS NOT NULL;
END
GO
