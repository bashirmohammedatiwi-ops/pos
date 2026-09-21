-- Import all salesmen from HAYAT2025 (Edari File11n only has ~49 active sellers).
IF DB_ID(N'HAYAT2025.mdf') IS NOT NULL
BEGIN
    SET IDENTITY_INSERT dbo.salesmen ON;

    INSERT INTO dbo.salesmen (id, name, password)
    SELECT h.id,
           LTRIM(RTRIM(CONVERT(NVARCHAR(200), h.name))),
           N''
    FROM [HAYAT2025.mdf].dbo.salesmen h
    WHERE h.name IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(NVARCHAR(200), h.name))) <> N''
      AND NOT EXISTS (SELECT 1 FROM dbo.salesmen s WHERE s.id = h.id);

    SET IDENTITY_INSERT dbo.salesmen OFF;

    UPDATE s
    SET s.name = LTRIM(RTRIM(CONVERT(NVARCHAR(200), h.name)))
    FROM dbo.salesmen s
    INNER JOIN [HAYAT2025.mdf].dbo.salesmen h ON h.id = s.id
    WHERE h.name IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(NVARCHAR(200), h.name))) <> N''
      AND (
        s.name <> LTRIM(RTRIM(CONVERT(NVARCHAR(200), h.name)))
        OR (
          h.name LIKE N'%[ء-ي]%'
          AND s.name NOT LIKE N'%[ء-ي]%'
        )
      );
END;
