-- Cashier permission: show salesman name on printed receipt (POS respects print template when enabled).
IF COL_LENGTH('cashiers_permissions', 'print_salesman_on_receipt') IS NULL
    ALTER TABLE cashiers_permissions
        ADD print_salesman_on_receipt BIT NOT NULL CONSTRAINT DF_cp_print_salesman_on_receipt DEFAULT 1;
