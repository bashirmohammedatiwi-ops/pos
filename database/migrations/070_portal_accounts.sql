-- Visible portal secrets for admin (staff forget PINs). Hash still used for login.
IF COL_LENGTH('ext_seller_accounts', 'pin_display') IS NULL
    ALTER TABLE ext_seller_accounts ADD pin_display NVARCHAR(20) NULL;
GO

IF COL_LENGTH('ext_users', 'password_display') IS NULL
    ALTER TABLE ext_users ADD password_display NVARCHAR(80) NULL;
GO
