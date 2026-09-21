-- User-controlled receipt typography for thermal printing.
IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID('print_options')
      AND name = 'font_weight'
)
    ALTER TABLE print_options ADD font_weight INT NOT NULL
        CONSTRAINT DF_print_options_font_weight DEFAULT 400;
GO

UPDATE print_options
SET font_size = CASE
        WHEN font_size < 9 THEN 9
        WHEN font_size > 22 THEN 22
        ELSE font_size
    END,
    font_weight = CASE
        WHEN font_weight < 300 THEN 300
        WHEN font_weight > 700 THEN 700
        ELSE font_weight
    END;
GO
