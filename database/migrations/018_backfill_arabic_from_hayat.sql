-- Restore Arabic product/branch names from legacy HAYAT2025 database (NexusDB ADO corrupts Arabic).
IF DB_ID(N'HAYAT2025.mdf') IS NOT NULL
BEGIN
    UPDATE a
    SET a.Name1 = h.Name1
    FROM dbo.articles a
    INNER JOIN [HAYAT2025.mdf].dbo.articles h ON h.Seq = a.Seq
    WHERE h.Name1 IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(NVARCHAR(4000), h.Name1))) <> N''
      AND (
        a.Name1 IS NULL
        OR LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) = N''
        OR (
          h.Name1 LIKE N'%[ء-ي]%'
          AND (a.Name1 NOT LIKE N'%[ء-ي]%' OR LEN(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1)))) < LEN(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), h.Name1)))) - 2)
        )
      );

    UPDATE eb
    SET eb.name = hb.name
    FROM dbo.edari_branches eb
    INNER JOIN [HAYAT2025.mdf].dbo.edari_branches hb ON hb.erp_seq = eb.erp_seq
    WHERE hb.name IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(NVARCHAR(200), hb.name))) <> N''
      AND (
        eb.name IS NULL
        OR eb.name LIKE N'فرع Edari%'
        OR eb.name <> hb.name
      );

    UPDATE s
    SET s.name = hb.name
    FROM dbo.sections s
    INNER JOIN [HAYAT2025.mdf].dbo.edari_branches hb ON hb.erp_seq = s.edari_branch_id
    WHERE hb.name IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(NVARCHAR(200), hb.name))) <> N''
      AND (
        s.name IS NULL
        OR s.name LIKE N'فرع Edari%'
        OR s.name <> hb.name
      );
END;
