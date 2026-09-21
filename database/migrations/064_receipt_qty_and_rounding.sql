-- Total piece count on the receipt, and the cash rounding step applied to the
-- final total (Iraqi cash has no coins below 250 IQD).
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('print_options')
      AND name = 'show_total_quantity'
)
    ALTER TABLE print_options ADD show_total_quantity BIT NOT NULL
        CONSTRAINT DF_print_options_show_total_quantity DEFAULT 1;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('print_options')
      AND name = 'round_total_to'
)
    ALTER TABLE print_options ADD round_total_to INT NOT NULL
        CONSTRAINT DF_print_options_round_total_to DEFAULT 250;
GO

UPDATE print_options
SET round_total_to = CASE
        WHEN round_total_to < 0 THEN 0
        WHEN round_total_to > 100000 THEN 100000
        ELSE round_total_to
    END;
GO
