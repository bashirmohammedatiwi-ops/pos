-- Manual transfer mode + stored per-product discount percent.

IF COL_LENGTH('cashiers_permissions', 'manual_transfer') IS NULL
    ALTER TABLE cashiers_permissions ADD manual_transfer BIT NOT NULL CONSTRAINT DF_cp_manual_transfer DEFAULT 0;
GO

IF COL_LENGTH('cashiers_permissions', 'allow_product_discount') IS NULL
    ALTER TABLE cashiers_permissions ADD allow_product_discount BIT NOT NULL CONSTRAINT DF_cp_allow_product_discount DEFAULT 0;
GO

IF COL_LENGTH('point_of_sales', 'deferred_offline') IS NULL
    ALTER TABLE point_of_sales ADD deferred_offline INT NOT NULL CONSTRAINT DF_pos_deferred_offline DEFAULT 0;
GO

IF COL_LENGTH('articles', 'ext_discount_percent') IS NULL
    ALTER TABLE articles ADD ext_discount_percent INT NOT NULL CONSTRAINT DF_articles_ext_discount_percent DEFAULT 0;
GO

-- Change-tracking watermark for the POS delta sync. ROWVERSION auto-increments on every
-- UPDATE/INSERT of the row (admin edits, POS product-discount edits, Edari refresh), so
-- terminals receive product changes immediately instead of waiting for Edari's Seq to move.
IF COL_LENGTH('articles', 'ext_row_version') IS NULL
    ALTER TABLE articles ADD ext_row_version ROWVERSION;
GO

IF COL_LENGTH('articles', 'ext_row_version') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_articles_ext_row_version')
    CREATE INDEX IX_articles_ext_row_version ON articles(ext_row_version);
GO
