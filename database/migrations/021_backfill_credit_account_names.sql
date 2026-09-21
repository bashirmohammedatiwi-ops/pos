-- Restore Arabic credit account names from HAYAT2025 accounts table.
IF DB_ID(N'HAYAT2025.mdf') IS NOT NULL
BEGIN
    UPDATE e
    SET e.account_name = LTRIM(RTRIM(CONVERT(NVARCHAR(4000), h.Name1))),
        e.account_num = LTRIM(RTRIM(CONVERT(NVARCHAR(100), h.Num)))
    FROM dbo.ext_pos_credit_accounts e
    INNER JOIN [HAYAT2025.mdf].dbo.accounts h ON h.Seq = e.edari_seq AND h.Cod = 1
    WHERE h.Name1 IS NOT NULL
      AND LTRIM(RTRIM(CONVERT(NVARCHAR(4000), h.Name1))) <> N''
      AND (
        e.account_name IS NULL
        OR e.account_name <> LTRIM(RTRIM(CONVERT(NVARCHAR(4000), h.Name1)))
        OR (
          h.Name1 LIKE N'%[ء-ي]%'
          AND e.account_name NOT LIKE N'%[ء-ي]%'
        )
      );
END;
