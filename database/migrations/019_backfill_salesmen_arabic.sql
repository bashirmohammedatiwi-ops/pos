-- Restore Arabic salesman names from HAYAT2025 (NexusDB ADO returns Num only).
IF DB_ID(N'HAYAT2025.mdf') IS NOT NULL
BEGIN
    UPDATE s
    SET s.name = h.name
    FROM dbo.salesmen s
    INNER JOIN [HAYAT2025.mdf].dbo.salesmen h ON h.id = s.id
    WHERE h.name IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(NVARCHAR(200), h.name))) <> N''
      AND (
        s.name IS NULL
        OR s.name <> h.name
        OR (
          h.name LIKE N'%[ء-ي]%'
          AND s.name NOT LIKE N'%[ء-ي]%'
        )
      );
END;
