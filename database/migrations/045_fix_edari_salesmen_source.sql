-- Purge File11n chart nodes wrongly synced as salesmen; reset Edari flags.
IF OBJECT_ID(N'dbo.ext_edari_salesmen', N'U') IS NOT NULL
    DELETE FROM dbo.ext_edari_salesmen;

IF COL_LENGTH(N'dbo.salesmen', N'is_edari') IS NOT NULL
    UPDATE dbo.salesmen SET is_edari = 0;

IF COL_LENGTH(N'dbo.salesmen', N'sort_num') IS NOT NULL
    UPDATE dbo.salesmen SET sort_num = NULL;

-- Ghost rows from old File11n Cod=2 sync (e.g. 363, 2227) with no sales history.
DELETE sm
FROM dbo.salesmen sm
WHERE sm.id > 250
  AND NOT EXISTS (SELECT 1 FROM dbo.reciepts r WHERE r.salesman = sm.id)
  AND NOT EXISTS (SELECT 1 FROM dbo.reciept_items ri WHERE ri.salesman_id = sm.id)
  AND NOT EXISTS (SELECT 1 FROM dbo.ext_commission_calculations c WHERE c.salesman_id = sm.id)
  AND NOT EXISTS (SELECT 1 FROM dbo.ext_salesman_commission_profiles p WHERE p.salesman_id = sm.id)
  AND NOT EXISTS (SELECT 1 FROM dbo.ext_commission_group_salesmen gs WHERE gs.salesman_id = sm.id);

-- Seed registry from Edari admin seller slots 1..250 (named and empty).
IF OBJECT_ID(N'dbo.ext_edari_salesmen', N'U') IS NOT NULL
BEGIN
    INSERT INTO dbo.ext_edari_salesmen (salesman_id, sort_num)
    SELECT sm.id, sm.id
    FROM dbo.salesmen sm
    WHERE sm.id BETWEEN 1 AND 250;

    IF COL_LENGTH(N'dbo.salesmen', N'is_edari') IS NOT NULL
        UPDATE dbo.salesmen SET is_edari = 1 WHERE id BETWEEN 1 AND 250;

    IF COL_LENGTH(N'dbo.salesmen', N'sort_num') IS NOT NULL
        UPDATE dbo.salesmen SET sort_num = id WHERE id BETWEEN 1 AND 250;
END;
