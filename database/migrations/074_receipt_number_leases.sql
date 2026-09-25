-- Blocks of official receipt numbers reserved by a terminal so offline sales
-- print the same number the server later adopts.
IF OBJECT_ID(N'dbo.receipt_number_leases', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.receipt_number_leases (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [year] INT NOT NULL,
        cashier_id BIGINT NOT NULL,
        from_seq INT NOT NULL,
        to_seq INT NOT NULL,
        hw_id NVARCHAR(80) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_receipt_number_leases_created DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_receipt_number_leases_lookup
        ON dbo.receipt_number_leases ([year], cashier_id, from_seq, to_seq);
END
GO
