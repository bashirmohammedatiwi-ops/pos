-- Authoritative list of Edari admin sellers (HAYAT salesmen ids 1..250). Populated on every sync.
IF OBJECT_ID(N'dbo.ext_edari_salesmen', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_edari_salesmen (
        salesman_id BIGINT NOT NULL CONSTRAINT PK_ext_edari_salesmen PRIMARY KEY,
        sort_num INT NOT NULL,
        synced_at DATETIME2 NOT NULL CONSTRAINT DF_ext_edari_salesmen_synced DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_ext_edari_salesmen_sort ON dbo.ext_edari_salesmen (sort_num);
END;

-- Backfill from prior sync flags (042 cleared sort_num; 043 may have missed backfill).
IF COL_LENGTH(N'dbo.salesmen', N'is_edari') IS NOT NULL
BEGIN
    INSERT INTO dbo.ext_edari_salesmen (salesman_id, sort_num)
    SELECT sm.id, COALESCE(sm.sort_num, sm.id)
    FROM dbo.salesmen sm
    WHERE sm.is_edari = 1
      AND sm.name IS NOT NULL
      AND LTRIM(RTRIM(sm.name)) <> N''
      AND NOT EXISTS (SELECT 1 FROM dbo.ext_edari_salesmen e WHERE e.salesman_id = sm.id);
END;

IF COL_LENGTH(N'dbo.salesmen', N'sort_num') IS NOT NULL
BEGIN
    INSERT INTO dbo.ext_edari_salesmen (salesman_id, sort_num)
    SELECT sm.id, sm.sort_num
    FROM dbo.salesmen sm
    WHERE sm.sort_num IS NOT NULL
      AND sm.name IS NOT NULL
      AND LTRIM(RTRIM(sm.name)) <> N''
      AND NOT EXISTS (SELECT 1 FROM dbo.ext_edari_salesmen e WHERE e.salesman_id = sm.id);
END;
