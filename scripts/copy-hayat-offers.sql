SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() <> N'FOT_POS_V2'
BEGIN
    RAISERROR(N'Refused: connected database is not FOT_POS_V2', 16, 1);
    RETURN;
END

IF DB_ID(N'HAYAT2025.mdf') IS NULL
BEGIN
    RAISERROR(N'Refused: HAYAT2025.mdf is not attached', 16, 1);
    RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.offers) OR EXISTS (SELECT 1 FROM dbo.offer_details)
BEGIN
    RAISERROR(N'Refused: FOT_POS_V2 already has offers — wipe or clear them first', 16, 1);
    RETURN;
END

BEGIN TRANSACTION;

SET IDENTITY_INSERT dbo.offers ON;
INSERT INTO dbo.offers (id, name, priority, remarks, enabled, type, master_account)
SELECT id, name, priority, remarks, enabled, type, master_account
FROM [HAYAT2025.mdf].dbo.offers;
SET IDENTITY_INSERT dbo.offers OFF;

SET IDENTITY_INSERT dbo.offer_details ON;
INSERT INTO dbo.offer_details (
    id, offer_id, from_date, to_date, from_time, to_time, Unlimited,
    total_reciept_value, item_id, item_quantity, free_item_id, free_item_quantity,
    discount_type, discount, exception_item_id
)
SELECT
    id, offer_id, from_date, to_date, from_time, to_time, Unlimited,
    total_reciept_value, item_id, item_quantity, free_item_id, free_item_quantity,
    discount_type, discount, exception_item_id
FROM [HAYAT2025.mdf].dbo.offer_details;
SET IDENTITY_INSERT dbo.offer_details OFF;

DECLARE @maxOffer bigint = (SELECT ISNULL(MAX(id), 0) FROM dbo.offers);
DECLARE @maxDetail bigint = (SELECT ISNULL(MAX(id), 0) FROM dbo.offer_details);
DBCC CHECKIDENT (N'dbo.offers', RESEED, @maxOffer) WITH NO_INFOMSGS;
DBCC CHECKIDENT (N'dbo.offer_details', RESEED, @maxDetail) WITH NO_INFOMSGS;

COMMIT TRANSACTION;

PRINT N'Copied offers from HAYAT2025.mdf';
SELECT 'offers' AS t, COUNT(*) AS c FROM dbo.offers
UNION ALL SELECT 'offer_details', COUNT(*) FROM dbo.offer_details
UNION ALL SELECT 'enabled_offers', COUNT(*) FROM dbo.offers WHERE enabled = 1
UNION ALL SELECT 'discounted_lines', COUNT(*) FROM dbo.offer_details WHERE ISNULL(discount, 0) > 0;
