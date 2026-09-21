-- Seller portal accounts (PIN login for salesmen)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_seller_accounts')
CREATE TABLE ext_seller_accounts (
    salesman_id      BIGINT NOT NULL PRIMARY KEY,
    pin_hash         NVARCHAR(200) NOT NULL,
    must_change_pin  BIT NOT NULL CONSTRAINT DF_ext_seller_accounts_change DEFAULT (0),
    is_active        BIT NOT NULL CONSTRAINT DF_ext_seller_accounts_active DEFAULT (1),
    created_at       DATETIME2 NOT NULL CONSTRAINT DF_ext_seller_accounts_created DEFAULT (SYSUTCDATETIME()),
    last_login_at    DATETIME2 NULL
);
GO
