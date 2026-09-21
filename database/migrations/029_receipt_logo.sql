-- Receipt logo + extended thermal layout options
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'logo_url')
    ALTER TABLE print_options ADD logo_url NVARCHAR(500) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_logo')
    ALTER TABLE print_options ADD show_logo BIT NOT NULL CONSTRAINT DF_print_options_show_logo DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_item_table')
    ALTER TABLE print_options ADD show_item_table BIT NOT NULL CONSTRAINT DF_print_options_show_item_table DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_subtotal')
    ALTER TABLE print_options ADD show_subtotal BIT NOT NULL CONSTRAINT DF_print_options_show_subtotal DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'show_payment_lines')
    ALTER TABLE print_options ADD show_payment_lines BIT NOT NULL CONSTRAINT DF_print_options_show_payment_lines DEFAULT 1;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('print_options') AND name = 'logo_max_height_px')
    ALTER TABLE print_options ADD logo_max_height_px INT NOT NULL CONSTRAINT DF_print_options_logo_max_height DEFAULT 72;
GO
