-- Columns the cashier login path reads. Missing any of these returns HTTP 500
-- ("تعذر تنفيذ الطلب") even when the username and PIN are correct.

IF COL_LENGTH('point_of_sales', 'allow_offline_mode') IS NULL
    ALTER TABLE point_of_sales ADD allow_offline_mode BIT NOT NULL CONSTRAINT DF_pos_allow_offline DEFAULT 1;
GO

IF COL_LENGTH('point_of_sales', 'remarks') IS NULL
    ALTER TABLE point_of_sales ADD remarks NVARCHAR(400) NULL;
GO

IF COL_LENGTH('point_of_sales', 'vfd_first_line') IS NULL
    ALTER TABLE point_of_sales ADD vfd_first_line NVARCHAR(40) NULL;
GO

IF COL_LENGTH('point_of_sales', 'vfd_second_line') IS NULL
    ALTER TABLE point_of_sales ADD vfd_second_line NVARCHAR(40) NULL;
GO

IF COL_LENGTH('point_of_sales', 'mpos_service') IS NULL
    ALTER TABLE point_of_sales ADD mpos_service NVARCHAR(100) NULL;
GO

IF COL_LENGTH('point_of_sales', 'mpos_com_port') IS NULL
    ALTER TABLE point_of_sales ADD mpos_com_port NVARCHAR(20) NULL;
GO

IF COL_LENGTH('cashiers', 'receipt_num') IS NULL
    ALTER TABLE cashiers ADD receipt_num INT NULL;
GO

IF COL_LENGTH('cashiers', 'receipt_num') IS NOT NULL
    AND EXISTS (SELECT 1 FROM cashiers WHERE receipt_num IS NULL OR receipt_num <= 0)
BEGIN
    ;WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
        FROM cashiers
    )
    UPDATE c
    SET receipt_num = r.rn
    FROM cashiers c
    INNER JOIN ranked r ON r.id = c.id
    WHERE c.receipt_num IS NULL OR c.receipt_num <= 0;
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
