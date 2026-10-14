using Dapper;

using FOT.Pos.Shared.Dtos;

using FOT.Pos.Infrastructure.Data;

using Microsoft.Data.SqlClient;



namespace FOT.Pos.Infrastructure.Repositories;



public sealed class OfferSalesReportRepository(ISqlConnectionFactory db, PrintRepository print)

{

    // Verbatim string — leading newline so concatenation after SELECT lists stays valid SQL.

    private const string SalesJoinSql = @"

FROM reciept_items ri

INNER JOIN reciepts r ON r.id = ri.reciept_id

INNER JOIN articles a ON a.id = ri.article_id

INNER JOIN offer_details od

    ON od.offer_id = @offerId

   AND od.detail_role IN (0, 1)

   AND COALESCE(od.excluded, 0) = 0

   AND od.item_id = a.Seq

WHERE CAST(r.creation_date AS date) BETWEEN @from AND @to

  AND r.is_pending = 0

  AND r.kind IN (0, 1)

";



    private const string PeriodFromDetailsSql = """

        SELECT d.offer_id,

               MIN(CAST(d.from_date AS date)) AS period_from,

               MAX(CAST(d.to_date AS date)) AS period_to

        FROM offer_details d

        WHERE COALESCE(d.Unlimited, 0) = 0

          AND d.from_date IS NOT NULL

          AND d.to_date IS NOT NULL

        GROUP BY d.offer_id

        """;



    public async Task EnsureRecordedForOffersAsync(IReadOnlyList<long> offerIds, CancellationToken ct)

    {

        if (offerIds.Count == 0) return;

        await using var conn = await db.CreateOpenConnectionAsync(ct);

        await conn.ExecuteAsync(new CommandDefinition(

            """

            INSERT INTO ext_offer_sales_closures (offer_id, offer_name, period_from, period_to)

            SELECT o.id,

                   LTRIM(RTRIM(CONVERT(NVARCHAR(500), o.name))),

                   pd.period_from,

                   pd.period_to

            FROM offers o

            INNER JOIN (

            """ + PeriodFromDetailsSql + """

            ) pd ON pd.offer_id = o.id

            WHERE o.id IN @offerIds

              AND NOT EXISTS (SELECT 1 FROM ext_offer_sales_closures c WHERE c.offer_id = o.id)

            """, new { offerIds }, cancellationToken: ct));

    }



    public async Task SyncMissingClosuresAsync(CancellationToken ct)

    {

        await using var conn = await db.CreateOpenConnectionAsync(ct);

        await conn.ExecuteAsync(new CommandDefinition(

            """

            INSERT INTO ext_offer_sales_closures (offer_id, offer_name, period_from, period_to)

            SELECT o.id,

                   LTRIM(RTRIM(CONVERT(NVARCHAR(500), o.name))),

                   pd.period_from,

                   pd.period_to

            FROM offers o

            INNER JOIN (

            """ + PeriodFromDetailsSql + """

            ) pd ON pd.offer_id = o.id

            WHERE o.enabled = 0

              AND CAST(pd.period_to AS date) < CAST(GETDATE() AS date)

              AND NOT EXISTS (SELECT 1 FROM ext_offer_sales_closures c WHERE c.offer_id = o.id)

            """, cancellationToken: ct));

    }



    public async Task<IReadOnlyList<OfferSalesClosureDto>> ListClosuresAsync(CancellationToken ct)

    {

        try

        {

            await SyncMissingClosuresAsync(ct);

        }

        catch (SqlException ex) when (ex.Number is 208 or 207)

        {

            return [];

        }



        const string sql = """

            SELECT c.id AS Id,

                   c.offer_id AS OfferId,

                   c.offer_name AS OfferName,

                   c.period_from AS PeriodFrom,

                   c.period_to AS PeriodTo,

                   c.closed_at AS ClosedAt,

                   CAST(COALESCE(agg.TotalAmount, 0) AS DECIMAL(18,2)) AS TotalAmount,

                   CAST(COALESCE(agg.TotalQuantity, 0) AS DECIMAL(18,6)) AS TotalQuantity

            FROM ext_offer_sales_closures c

            OUTER APPLY (

                SELECT CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS TotalAmount,

                       CAST(SUM(ri.quantity) AS DECIMAL(18,6)) AS TotalQuantity

                FROM reciept_items ri

                INNER JOIN reciepts r ON r.id = ri.reciept_id

                INNER JOIN articles a ON a.id = ri.article_id

                INNER JOIN offer_details od

                    ON od.offer_id = c.offer_id

                   AND od.detail_role IN (0, 1)

                   AND COALESCE(od.excluded, 0) = 0

                   AND od.item_id = a.Seq

                WHERE CAST(r.creation_date AS date) BETWEEN c.period_from AND c.period_to

                  AND r.is_pending = 0

                  AND r.kind IN (0, 1)

            ) agg

            ORDER BY c.closed_at DESC, c.id DESC

            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);

        try

        {

            return (await conn.QueryRowsAsync<OfferSalesClosureDto>(

                new CommandDefinition(sql, cancellationToken: ct))).ToList();

        }

        catch (SqlException ex) when (ex.Number is 208 or 207)

        {

            return [];

        }

    }



    public async Task<OfferSalesReportDto> GetReportAsync(long offerId, CancellationToken ct)

    {

        await using var conn = await db.CreateOpenConnectionAsync(ct);

        var meta = await LoadMetaAsync(conn, offerId, ct);

        if (meta is null)

            throw new InvalidOperationException("العرض غير موجود أو لا يحتوي على فترة بداية ونهاية محددة.");



        var from = meta.PeriodFrom.Date;

        var to = meta.PeriodTo.Date;

        var periodDays = Math.Max(1, (to - from).Days + 1);

        var p = new { offerId, from, to };



        var linesSql = """

            SELECT

                a.Seq AS ArticleSeq,

                COALESCE(

                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Barcode))), N''),

                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), ri.barcode))), N''),

                    NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Num))), N'')

                ) AS Barcode,

                MAX(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1)))) AS Name,

                CAST(SUM(ri.quantity) AS DECIMAL(18,6)) AS Quantity,

                CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS Amount,

                CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS ListAmount

            """ + SalesJoinSql + """

            GROUP BY a.Seq

            HAVING SUM(ri.quantity) <> 0

            ORDER BY SUM(ri.quantity * ri.price) DESC, MAX(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))))

            """;



        var productRows = (await conn.QueryAsync<OfferProductAggRow>(new CommandDefinition(

            linesSql, p, cancellationToken: ct))).ToList();



        var totalAmount = productRows.Sum(x => x.Amount);

        var products = productRows.Select(r =>

        {

            var listAmount = r.ListAmount > 0 ? r.ListAmount : r.Amount;

            var discount = Math.Max(0, listAmount - r.Amount);

            var share = totalAmount > 0 ? Math.Round(r.Amount / totalAmount * 100, 2) : 0;

            return new OfferSalesProductRowDto(

                r.ArticleSeq, r.Barcode, r.Name, r.Quantity, r.Amount, listAmount, discount, share);

        }).ToList();



        var dailySql = """

            SELECT CAST(r.creation_date AS date) AS [Date],

                   CAST(SUM(ri.quantity) AS DECIMAL(18,6)) AS Quantity,

                   CAST(SUM(ri.quantity * ri.price) AS DECIMAL(18,2)) AS Amount,

                   COUNT(DISTINCT r.id) AS ReceiptCount

            """ + SalesJoinSql + """

            GROUP BY CAST(r.creation_date AS date)

            ORDER BY CAST(r.creation_date AS date)

            """;



        var daily = (await conn.QueryRowsAsync<OfferSalesDailyRowDto>(new CommandDefinition(

            dailySql, p, cancellationToken: ct))).ToList();



        var receiptCountSql = """

            SELECT COUNT(DISTINCT r.id)

            """ + SalesJoinSql;



        var receiptCount = await conn.ExecuteScalarAsync<int>(new CommandDefinition(

            receiptCountSql, p, cancellationToken: ct));



        const string unsoldSql = """

            SELECT TOP 40

                COALESCE(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Barcode))), N''), NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Num))), N'')) AS Barcode,

                LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))) AS Name

            FROM offer_details od

            INNER JOIN articles a ON a.Seq = od.item_id

              AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL

            WHERE od.offer_id = @offerId

              AND od.detail_role IN (0, 1)

              AND COALESCE(od.excluded, 0) = 0

              AND od.item_id IS NOT NULL

              AND NOT EXISTS (

                  SELECT 1

                  FROM reciept_items ri

                  INNER JOIN reciepts r ON r.id = ri.reciept_id

                  INNER JOIN articles ax ON ax.id = ri.article_id AND ax.Seq = od.item_id

                  WHERE CAST(r.creation_date AS date) BETWEEN @from AND @to

                    AND r.is_pending = 0

                    AND r.kind IN (0, 1)

                    AND ri.quantity <> 0

              )

            ORDER BY a.Name1

            """;



        var unsoldSamples = (await conn.QueryRowsAsync<OfferSalesUnsoldRowDto>(new CommandDefinition(

            unsoldSql, p, cancellationToken: ct))).ToList();



        const string unsoldCountSql = """

            SELECT COUNT(DISTINCT od.item_id)

            FROM offer_details od

            WHERE od.offer_id = @offerId

              AND od.detail_role IN (0, 1)

              AND COALESCE(od.excluded, 0) = 0

              AND od.item_id IS NOT NULL

              AND NOT EXISTS (

                  SELECT 1

                  FROM reciept_items ri

                  INNER JOIN reciepts r ON r.id = ri.reciept_id

                  INNER JOIN articles ax ON ax.id = ri.article_id AND ax.Seq = od.item_id

                  WHERE CAST(r.creation_date AS date) BETWEEN @from AND @to

                    AND r.is_pending = 0

                    AND r.kind IN (0, 1)

                    AND ri.quantity <> 0

              )

            """;



        var unsoldCount = await conn.ExecuteScalarAsync<int>(new CommandDefinition(

            unsoldCountSql, p, cancellationToken: ct));



        var soldCount = products.Count;

        var totalQty = products.Sum(x => x.Quantity);

        var totalList = products.Sum(x => x.ListAmount);

        var totalDiscount = Math.Max(0, totalList - totalAmount);

        var avgDaily = periodDays > 0 ? totalAmount / periodDays : 0;

        var avgTicket = receiptCount > 0 ? totalAmount / receiptCount : 0;



        var printSettings = await print.GetSettingsAsync(ct);

        var store = string.IsNullOrWhiteSpace(printSettings.HeaderText)

            ? printSettings.HeaderDescription

            : printSettings.HeaderText;



        return new OfferSalesReportDto(

            meta.OfferId,

            meta.OfferName ?? "",

            meta.OfferType,

            meta.DiscountPercent,

            meta.PeriodFrom,

            meta.PeriodTo,

            periodDays,

            string.IsNullOrWhiteSpace(store) ? null : store.Trim(),

            meta.ScopeProductCount,

            soldCount,

            unsoldCount,

            receiptCount,

            totalQty,

            totalAmount,

            totalList,

            totalDiscount,

            avgDaily,

            avgTicket,

            DateTime.Now,

            daily,

            products,

            unsoldSamples);

    }



    private static async Task<OfferPeriodMeta?> LoadMetaAsync(System.Data.IDbConnection conn, long offerId, CancellationToken ct)

    {

        var fromDetailsSql = """

            SELECT o.id AS OfferId,

                   LTRIM(RTRIM(CONVERT(NVARCHAR(500), o.name))) AS OfferName,

                   o.type AS OfferType,

                   CAST(COALESCE(sc.discount, 0) AS DECIMAL(18,2)) AS DiscountPercent,

                   pd.period_from AS PeriodFrom,

                   pd.period_to AS PeriodTo,

                   COALESCE(sc.scope_count, 0) AS ScopeProductCount

            FROM offers o

            INNER JOIN (

            """ + PeriodFromDetailsSql + """

            ) pd ON pd.offer_id = o.id

            OUTER APPLY (

                SELECT MAX(CAST(d.discount AS DECIMAL(18,2))) AS discount,

                       COUNT(DISTINCT CASE WHEN COALESCE(d.excluded, 0) = 0 AND d.item_id IS NOT NULL THEN d.item_id END) AS scope_count

                FROM offer_details d

                WHERE d.offer_id = o.id AND d.detail_role IN (0, 1)

            ) sc

            WHERE o.id = @offerId

            """;



        var meta = await conn.QuerySingleOrDefaultAsync<OfferPeriodMeta>(new CommandDefinition(

            fromDetailsSql, new { offerId }, cancellationToken: ct));

        if (meta is not null) return meta;



        const string fromClosureSql = """

            SELECT o.id AS OfferId,

                   LTRIM(RTRIM(CONVERT(NVARCHAR(500), COALESCE(c.offer_name, o.name)))) AS OfferName,

                   o.type AS OfferType,

                   CAST(COALESCE(sc.discount, 0) AS DECIMAL(18,2)) AS DiscountPercent,

                   c.period_from AS PeriodFrom,

                   c.period_to AS PeriodTo,

                   COALESCE(sc.scope_count, 0) AS ScopeProductCount

            FROM ext_offer_sales_closures c

            INNER JOIN offers o ON o.id = c.offer_id

            OUTER APPLY (

                SELECT MAX(CAST(d.discount AS DECIMAL(18,2))) AS discount,

                       COUNT(DISTINCT CASE WHEN COALESCE(d.excluded, 0) = 0 AND d.item_id IS NOT NULL THEN d.item_id END) AS scope_count

                FROM offer_details d

                WHERE d.offer_id = o.id AND d.detail_role IN (0, 1)

            ) sc

            WHERE c.offer_id = @offerId

            """;



        try

        {

            return await conn.QuerySingleOrDefaultAsync<OfferPeriodMeta>(new CommandDefinition(

                fromClosureSql, new { offerId }, cancellationToken: ct));

        }

        catch (SqlException ex) when (ex.Number is 208 or 207)

        {

            return null;

        }

    }



    private sealed class OfferPeriodMeta

    {

        public long OfferId { get; set; }

        public string? OfferName { get; set; }

        public int OfferType { get; set; }

        public decimal DiscountPercent { get; set; }

        public DateTime PeriodFrom { get; set; }

        public DateTime PeriodTo { get; set; }

        public int ScopeProductCount { get; set; }

    }



    private sealed class OfferProductAggRow

    {

        public long ArticleSeq { get; set; }

        public string? Barcode { get; set; }

        public string? Name { get; set; }

        public decimal Quantity { get; set; }

        public decimal Amount { get; set; }

        public decimal ListAmount { get; set; }

    }

}


