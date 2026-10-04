-- Deleted cart lines and cancelled invoices, recorded per cashier.
IF OBJECT_ID(N'dbo.ext_cashier_voids', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_cashier_voids (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        cashier_id BIGINT NOT NULL,
        pos_id BIGINT NULL,
        kind NVARCHAR(20) NOT NULL,
        product_name NVARCHAR(200) NULL,
        barcode NVARCHAR(80) NULL,
        quantity DECIMAL(18,3) NOT NULL CONSTRAINT DF_ext_cashier_voids_qty DEFAULT 0,
        amount DECIMAL(18,3) NOT NULL CONSTRAINT DF_ext_cashier_voids_amount DEFAULT 0,
        line_count INT NOT NULL CONSTRAINT DF_ext_cashier_voids_lines DEFAULT 0,
        receipt_num NVARCHAR(40) NULL,
        source NVARCHAR(20) NULL,
        lines_json NVARCHAR(MAX) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_ext_cashier_voids_created DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_ext_cashier_voids_cashier_time
        ON dbo.ext_cashier_voids (cashier_id, created_at);
    CREATE INDEX IX_ext_cashier_voids_time
        ON dbo.ext_cashier_voids (created_at);
END
