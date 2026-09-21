-- Three switchable thermal receipt layouts, chosen from the control panel.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'receipt_template')
    ALTER TABLE print_options ADD receipt_template NVARCHAR(20) NOT NULL
        CONSTRAINT DF_print_options_receipt_template DEFAULT N'classic';
GO

UPDATE print_options
SET receipt_template = N'classic'
WHERE receipt_template IS NULL OR LTRIM(RTRIM(receipt_template)) = N'';
GO
