-- Per-element typography and block order for the classic table receipt.
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('print_options')
      AND name = 'classic_style'
)
    ALTER TABLE print_options ADD classic_style NVARCHAR(MAX) NULL;
GO
