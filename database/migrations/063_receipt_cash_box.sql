-- Optional cash box line on the printed receipt.
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('print_options')
      AND name = 'show_cash_box'
)
    ALTER TABLE print_options ADD show_cash_box BIT NOT NULL
        CONSTRAINT DF_print_options_show_cash_box DEFAULT 1;
GO
