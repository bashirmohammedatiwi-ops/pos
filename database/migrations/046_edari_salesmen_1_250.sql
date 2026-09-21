-- Extend Edari seller registry to full admin range 1..250 (was incorrectly capped at 49).
IF OBJECT_ID(N'dbo.ext_edari_salesmen', N'U') IS NOT NULL
BEGIN
    DELETE FROM dbo.ext_edari_salesmen;

    INSERT INTO dbo.ext_edari_salesmen (salesman_id, sort_num)
    SELECT sm.id, sm.id
    FROM dbo.salesmen sm
    WHERE sm.id BETWEEN 1 AND 250;

    IF COL_LENGTH(N'dbo.salesmen', N'is_edari') IS NOT NULL
    BEGIN
        UPDATE dbo.salesmen SET is_edari = 0;
        UPDATE dbo.salesmen SET is_edari = 1 WHERE id BETWEEN 1 AND 250;
    END;

    IF COL_LENGTH(N'dbo.salesmen', N'sort_num') IS NOT NULL
    BEGIN
        UPDATE dbo.salesmen SET sort_num = NULL;
        UPDATE dbo.salesmen SET sort_num = id WHERE id BETWEEN 1 AND 250;
    END;
END;
