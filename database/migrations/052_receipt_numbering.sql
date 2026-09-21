-- Per-cashier yearly receipt numbers: {year}{cashierCode}{seq:6}
-- Example: 20261000001 = year 2026, cashier 1, invoice 1

IF COL_LENGTH('cashiers', 'receipt_num') IS NULL
    ALTER TABLE cashiers ADD receipt_num INT NULL;
GO

IF COL_LENGTH('cashiers', 'receipt_num') IS NOT NULL
    AND EXISTS (SELECT 1 FROM cashiers WHERE receipt_num IS NULL)
BEGIN
    ;WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
        FROM cashiers
    )
    UPDATE c
    SET receipt_num = r.rn
    FROM cashiers c
    INNER JOIN ranked r ON r.id = c.id
    WHERE c.receipt_num IS NULL;
END
GO

IF COL_LENGTH('cashiers', 'receipt_num') IS NOT NULL
BEGIN
    UPDATE cashiers SET receipt_num = 1 WHERE receipt_num IS NULL OR receipt_num <= 0;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = 'UX_cashiers_receipt_num' AND object_id = OBJECT_ID('cashiers'))
        CREATE UNIQUE NONCLUSTERED INDEX UX_cashiers_receipt_num ON cashiers(receipt_num);
END
GO

IF OBJECT_ID('receipt_number_sequences', 'U') IS NULL
BEGIN
    CREATE TABLE receipt_number_sequences (
        [year] INT NOT NULL,
        cashier_id BIGINT NOT NULL,
        last_seq INT NOT NULL CONSTRAINT DF_receipt_number_sequences_last_seq DEFAULT 0,
        CONSTRAINT PK_receipt_number_sequences PRIMARY KEY ([year], cashier_id)
    );
END
GO

-- New numbers are {year}{cashierCode}{seq:6} and do not fit in INT.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF EXISTS (
    SELECT 1
    FROM sys.columns c
    JOIN sys.types t ON c.user_type_id = t.user_type_id
    WHERE c.object_id = OBJECT_ID('reciepts') AND c.name = 'number' AND t.name IN ('int', 'smallint')
)
BEGIN
    DECLARE @df SYSNAME = (
        SELECT dc.name
        FROM sys.default_constraints dc
        JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID('reciepts') AND c.name = 'number'
    );
    IF @df IS NOT NULL
        EXEC('ALTER TABLE reciepts DROP CONSTRAINT [' + @df + ']');

    IF EXISTS (SELECT 1 FROM sys.objects WHERE name = 'sync_constraint' AND parent_object_id = OBJECT_ID('reciepts'))
        ALTER TABLE reciepts DROP CONSTRAINT sync_constraint;

    ALTER TABLE reciepts ALTER COLUMN number BIGINT NOT NULL;

    IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'sync_constraint' AND parent_object_id = OBJECT_ID('reciepts'))
        ALTER TABLE reciepts ADD CONSTRAINT sync_constraint UNIQUE (number, point_of_sale_id, state);
END
GO
