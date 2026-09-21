IF COL_LENGTH(OBJECT_ID(N'dbo.salesmen'), N'sort_num') IS NULL
    ALTER TABLE dbo.salesmen ADD sort_num INT NULL;
