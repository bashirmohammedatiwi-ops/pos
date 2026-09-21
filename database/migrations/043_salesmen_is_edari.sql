IF COL_LENGTH(N'dbo.salesmen', N'is_edari') IS NULL
BEGIN
    ALTER TABLE dbo.salesmen ADD is_edari BIT NOT NULL
        CONSTRAINT DF_salesmen_is_edari DEFAULT 0;
END;
GO

-- Mark rows already ordered by a prior Edari sync (separate batch: the column
-- must exist at parse time of this statement).
IF COL_LENGTH(N'dbo.salesmen', N'is_edari') IS NOT NULL
    UPDATE dbo.salesmen SET is_edari = 1 WHERE sort_num IS NOT NULL AND is_edari = 0;
