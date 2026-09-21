namespace FOT.Pos.Infrastructure.Data;

internal static class ProductSql
{
    public const string ActiveOffersCte = """
        ActiveOffers AS (
          SELECT od.item_id, od.discount, od.discount_type, od.offer_id,
                 CONVERT(NVARCHAR(4000), o.name) AS offer_name, o.priority,
                 ROW_NUMBER() OVER (
                   PARTITION BY od.item_id
                   ORDER BY o.priority DESC,
                     CASE
                       WHEN od.discount_type = 0 THEN CAST(od.discount AS DECIMAL(18,4))
                       WHEN COALESCE(NULLIF(a.SellPr4, 0), 0) <= 0 THEN CAST(0 AS DECIMAL(18,4))
                       WHEN od.discount_type = 2 THEN
                         CASE WHEN od.discount < a.SellPr4
                           THEN ((a.SellPr4 - od.discount) / a.SellPr4) * 100
                           ELSE CAST(0 AS DECIMAL(18,4)) END
                       ELSE (od.discount / a.SellPr4) * 100
                     END DESC,
                     od.offer_id
                 ) AS rn
          FROM dbo.offer_details od
          INNER JOIN dbo.offers o ON od.offer_id = o.id
          LEFT JOIN dbo.articles a ON a.Seq = od.item_id
          WHERE o.enabled = 1 AND COALESCE(od.excluded, 0) = 0
            AND (od.discount > 0 OR od.discount_type = 2) AND (
            od.Unlimited = 1 OR (od.from_date IS NULL AND od.to_date IS NULL)
            OR (od.from_date IS NULL AND od.to_date IS NOT NULL AND CAST(GETDATE() AS date) <= od.to_date)
            OR (od.to_date IS NULL AND od.from_date IS NOT NULL AND CAST(GETDATE() AS date) >= od.from_date)
            OR (od.from_date IS NOT NULL AND od.to_date IS NOT NULL AND CAST(GETDATE() AS date) BETWEEN od.from_date AND od.to_date)
          )
        )
        """;

    public const string SelectColumns = """
        a.id AS Id, a.Seq AS Seq, LTRIM(RTRIM(a.Num)) AS Num,
        LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name,
        LTRIM(RTRIM(a.Barcode)) AS Barcode,
        CAST(COALESCE(NULLIF(a.SellPr4,0),0) AS decimal(18,0)) AS OriginalPrice,
        CAST(0 AS decimal(18,0)) AS StoredFinalPrice,
        CAST(COALESCE(a.CurTot1,0) AS decimal(18,2)) AS Stock,
        CAST(ao.discount AS decimal(18,2)) AS DiscountValue,
        CAST(COALESCE(ao.discount_type,0) AS int) AS DiscountType,
        ao.offer_name AS OfferName,
        CAST(COALESCE(a.ext_discount_percent,0) AS int) AS StoredDiscountPercent,
        CONVERT(BIGINT, a.ext_row_version) AS ChangeVersion
        """;
}
