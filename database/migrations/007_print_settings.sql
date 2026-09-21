-- Extended print settings (legacy print_options + POS thermal options)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'paper_width_mm')
    ALTER TABLE print_options ADD paper_width_mm INT NOT NULL CONSTRAINT DF_print_options_paper_width DEFAULT 80;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'font_size')
    ALTER TABLE print_options ADD font_size INT NOT NULL CONSTRAINT DF_print_options_font_size DEFAULT 11;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_qr')
    ALTER TABLE print_options ADD show_qr BIT NOT NULL CONSTRAINT DF_print_options_show_qr DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_cashier')
    ALTER TABLE print_options ADD show_cashier BIT NOT NULL CONSTRAINT DF_print_options_show_cashier DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_salesman')
    ALTER TABLE print_options ADD show_salesman BIT NOT NULL CONSTRAINT DF_print_options_show_salesman DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_discounts')
    ALTER TABLE print_options ADD show_discounts BIT NOT NULL CONSTRAINT DF_print_options_show_discounts DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'auto_print')
    ALTER TABLE print_options ADD auto_print BIT NOT NULL CONSTRAINT DF_print_options_auto_print DEFAULT 1;
GO

UPDATE print_options SET show_qr = 1 WHERE qr_code IS NOT NULL AND LTRIM(RTRIM(qr_code)) <> '' AND show_qr = 0;
