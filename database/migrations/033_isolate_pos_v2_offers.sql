-- فصل عروض FOT POS V2 عن عروض الإداري/القديم (FilePosO)
-- يحذف العروض المستوردة من Edari فقط — العروض التي أنشأتها في لوحة التحكم الجديدة تبقى

USE [FOT_POS_V2];
GO

SET NOCOUNT ON;

IF OBJECT_ID('ext_edari_offer_map', 'U') IS NULL
BEGIN
    PRINT 'ext_edari_offer_map غير موجود — لا شيء للحذف';
    RETURN;
END

BEGIN TRANSACTION;
BEGIN TRY
    DECLARE @ids TABLE (id BIGINT PRIMARY KEY);
    INSERT INTO @ids (id)
    SELECT offer_id FROM ext_edari_offer_map;

  DELETE od
    FROM offer_details od
    INNER JOIN @ids i ON i.id = od.offer_id;

    DELETE o
    FROM offers o
    INNER JOIN @ids i ON i.id = o.id;

    DELETE FROM ext_edari_offer_map;

    -- إزالة أسعار العروض المخزنة في SellPr5 (مصدرها Edari القديم)
    UPDATE articles SET SellPr5 = 0 WHERE COALESCE(SellPr5, 0) <> 0;

    IF COL_LENGTH('edari_settings', 'catalog_sync_enabled') IS NOT NULL
        UPDATE edari_settings SET catalog_sync_enabled = 0;

    COMMIT TRANSACTION;
    PRINT 'تم — عروض Edari المستوردة محذوفة و SellPr5 صُفّر';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH
GO
