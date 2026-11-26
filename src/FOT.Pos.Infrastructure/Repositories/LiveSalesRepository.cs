using Dapper;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

/*
 * مبيعات المحل لتطبيق المدراء (تُرفع لخادم الفريق): «حزمة يوم» كاملة لكل يوم،
 * وإجماليات يومية خفيفة لسنة. نفس شروط تقرير الصندوق: is_pending=0، البيع kind=0،
 * المرتجع kind=1 يُطرح، الهدية kind=2 تُعدّ فقط. البائع لكل سطر، والقسم من نقطة البيع ثم الكاشير.
 */

public sealed class SalesDayTotals
{
    public decimal Net { get; set; }
    public decimal Gross { get; set; }
    public int Receipts { get; set; }
    public decimal Pieces { get; set; }
    public decimal ReturnsTotal { get; set; }
    public int ReturnsCount { get; set; }
    public int Gifts { get; set; }
    public decimal OffersDiscount { get; set; }
    public decimal UserDiscount { get; set; }
    public decimal ItemsDiscount { get; set; }
    public decimal CardTotal { get; set; }
    public int CardCount { get; set; }
    public DateTime? FirstAt { get; set; }
    public DateTime? LastAt { get; set; }
}

/// <summary>ساعة: H الساعة، T الصافي، N فواتير البيع.</summary>
public sealed class SalesHour
{
    public int H { get; set; }
    public decimal T { get; set; }
    public int N { get; set; }
}

/// <summary>صف مسمّى: T الصافي، N الفواتير، Q القطع (أو عدد المرتجعات للكاشير).</summary>
public sealed class SalesNamed
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string? Sub { get; set; }
    public decimal T { get; set; }
    public int N { get; set; }
    public decimal Q { get; set; }
    public DateTime? LastAt { get; set; }
    /// <summary>للكاشير: الخصم اليدوي.</summary>
    public decimal D { get; set; }
    /// <summary>للكاشير: عمليات الحذف من الفاتورة (عددها وقيمتها).</summary>
    public int V { get; set; }
    public decimal Va { get; set; }
}

public sealed class SalesProduct
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string? Barcode { get; set; }
    public decimal Q { get; set; }
    public decimal T { get; set; }
    public int N { get; set; }
}

public sealed class SalesReceipt
{
    public long Id { get; set; }
    public long Number { get; set; }
    public DateTime At { get; set; }
    public int Kind { get; set; }
    public decimal Total { get; set; }
    public int Items { get; set; }
    public string? Cashier { get; set; }
    public string? Pos { get; set; }
    public string? Seller { get; set; }
    public bool Card { get; set; }
}

public sealed class SalesTerminal
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string? Section { get; set; }
    public DateTime? LastSeen { get; set; }
    public DateTime? LastSaleAt { get; set; }
    public bool Active { get; set; }
}

public sealed record SalesDayPack(
    string Day,
    SalesDayTotals Totals,
    IReadOnlyList<SalesHour> Hours,
    IReadOnlyList<SalesNamed> Sections,
    IReadOnlyList<SalesNamed> Terminals,
    IReadOnlyList<SalesNamed> Cashiers,
    IReadOnlyList<SalesNamed> Sellers,
    IReadOnlyList<SalesProduct> Products);

public sealed class SalesDailyRow
{
    public string Day { get; set; } = "";
    public decimal Net { get; set; }
    public int Receipts { get; set; }
    public decimal ReturnsTotal { get; set; }
    public decimal Pieces { get; set; }
}

/// <summary>
/// صندوق كاشير يعمل اليوم (لتطبيق المدراء): كل فاتورة تُسجَّل على صندوق الإداري الذي اختاره الكاشير
/// (reciepts.master_account)؛ فواتير البطاقة تذهب لصندوق «كي» فتُنسب لكاشيرها هنا.
/// </summary>
public sealed class CashierBoxLive
{
    public long Seq { get; set; }
    public List<string> Cashiers { get; set; } = [];
    public string? Pos { get; set; }
    public string? Section { get; set; }
    public DateTime? LastSeen { get; set; }
    public bool Online { get; set; }
    public int Sales { get; set; }
    public decimal SalesTotal { get; set; }
    public int Returns { get; set; }
    public decimal ReturnsTotal { get; set; }
    public int Gifts { get; set; }
    /// <summary>النقد المتوقع في الدرج: مبيعات الصندوق − المرتجعات.</summary>
    public decimal Cash { get; set; }
    public int CardCount { get; set; }
    public decimal CardTotal { get; set; }
    /// <summary>كل ما باعه الكاشير اليوم: النقد + البطاقة.</summary>
    public decimal Total { get; set; }
    public decimal Discount { get; set; }
    public int Voids { get; set; }
    public decimal VoidsAmount { get; set; }
    public decimal Pieces { get; set; }
    public DateTime? FirstAt { get; set; }
    public DateTime? LastAt { get; set; }
    /// <summary>صافي كل ساعة (0–23) للنقد والبطاقة معاً.</summary>
    public decimal[] Hours { get; set; } = new decimal[24];
}

public sealed class LiveSalesRepository(ISqlConnectionFactory db)
{
    private sealed class BoxCashierRow
    {
        public long Acc { get; set; }
        public long CashierId { get; set; }
        public string? CashierName { get; set; }
        public long PosId { get; set; }
        public int Sales { get; set; }
        public decimal SalesTotal { get; set; }
        public int Returns { get; set; }
        public decimal ReturnsTotal { get; set; }
        public int Gifts { get; set; }
        public decimal Discount { get; set; }
        public DateTime? FirstAt { get; set; }
        public DateTime? LastAt { get; set; }
    }

    private sealed class CashierSum
    {
        public long CashierId { get; set; }
        public int N { get; set; }
        public decimal T { get; set; }
    }

    private sealed class HourRow
    {
        public long Key { get; set; }
        public int H { get; set; }
        public decimal T { get; set; }
    }

    private sealed class PosRow
    {
        public long Id { get; set; }
        public string? Name { get; set; }
        public string? Section { get; set; }
        public DateTime? LastSeen { get; set; }
    }

    /// <summary>
    /// صناديق الكاشير التي عملت اليوم بتفاصيلها: النقد، البطاقة، المرتجعات، الخصم، الحذف، الساعات، ونقطة البيع.
    /// skipAccounts: صناديق ليست كاشيراً (البطاقة، الهدايا) — فواتيرها تُنسب لكاشيرها لا تُعرض صندوقاً.
    /// </summary>
    public async Task<IReadOnlyList<CashierBoxLive>> CashierBoxesAsync(DateTime date, IReadOnlyCollection<long> skipAccounts, CancellationToken ct)
    {
        var sql = $"""
            SELECT CAST(COALESCE(r.master_account, 0) AS BIGINT) AS Acc, CAST(COALESCE(r.cashier_id, 0) AS BIGINT) AS CashierId,
                   COALESCE(MAX(NULLIF(LTRIM(RTRIM(c.account_name)), N'')), MAX(c.username)) AS CashierName,
                   CAST(COALESCE(MAX(r.point_of_sale_id), 0) AS BIGINT) AS PosId,
                   SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END) AS Sales,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN r.total_amount ELSE 0 END), 0) AS DECIMAL(18,2)) AS SalesTotal,
                   SUM(CASE WHEN r.kind = 1 THEN 1 ELSE 0 END) AS Returns,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN r.total_amount ELSE 0 END), 0) AS DECIMAL(18,2)) AS ReturnsTotal,
                   SUM(CASE WHEN r.kind = 2 THEN 1 ELSE 0 END) AS Gifts,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN COALESCE(r.user_discount, 0) ELSE 0 END), 0) AS DECIMAL(18,2)) AS Discount,
                   MIN(CASE WHEN r.kind IN (0,1) THEN r.creation_date END) AS FirstAt,
                   MAX(CASE WHEN r.kind IN (0,1) THEN r.creation_date END) AS LastAt
            FROM reciepts r LEFT JOIN cashiers c ON c.id = r.cashier_id
            WHERE {Where}
            GROUP BY COALESCE(r.master_account, 0), COALESCE(r.cashier_id, 0);

            SELECT CAST(COALESCE(r.cashier_id, 0) AS BIGINT) AS CashierId, COUNT(*) AS N,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -cc.amount ELSE cc.amount END), 0) AS DECIMAL(18,2)) AS T
            FROM reciepts r
            OUTER APPLY (SELECT TOP 1 k.reciept_id, CAST(k.amount AS DECIMAL(18,2)) AS amount FROM reciept_credit_card k WHERE k.reciept_id = r.id ORDER BY k.id DESC) cc
            WHERE {Where} AND r.kind IN (0,1) AND cc.reciept_id IS NOT NULL
            GROUP BY COALESCE(r.cashier_id, 0);

            SELECT CAST(v.cashier_id AS BIGINT) AS CashierId, COUNT(*) AS N, CAST(COALESCE(SUM(v.amount), 0) AS DECIMAL(18,2)) AS T
            FROM ext_cashier_voids v
            WHERE v.created_at >= @day AND v.created_at < @next
            GROUP BY v.cashier_id;

            SELECT CAST(COALESCE(r.cashier_id, 0) AS BIGINT) AS [Key], DATEPART(hour, r.creation_date) AS H, CAST(COALESCE(SUM({Net}), 0) AS DECIMAL(18,2)) AS T
            FROM reciepts r WHERE {Where} AND r.kind IN (0,1)
            GROUP BY COALESCE(r.cashier_id, 0), DATEPART(hour, r.creation_date);

            SELECT CAST(COALESCE(r.master_account, 0) AS BIGINT) AS [Key], 0 AS H, CAST(COALESCE(SUM({LineQty}), 0) AS DECIMAL(18,3)) AS T
            FROM reciept_items ri INNER JOIN reciepts r ON r.id = ri.reciept_id
            WHERE {Where} AND r.kind IN (0,1)
            GROUP BY COALESCE(r.master_account, 0);

            SELECT CAST(p.id AS BIGINT) AS Id, p.name AS Name, s.name AS Section, p.last_connection AS LastSeen
            FROM point_of_sales p LEFT JOIN sections s ON s.id = p.section_id
            WHERE COALESCE(p.is_deleted, 0) = 0;
            """;
        var day = date.Date;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            sql, new { day, next = day.AddDays(1) }, commandTimeout: 60, cancellationToken: ct));
        var rows = (await multi.ReadAsync<BoxCashierRow>()).ToList();
        var cards = (await multi.ReadAsync<CashierSum>()).ToDictionary(x => x.CashierId);
        var voids = (await multi.ReadAsync<CashierSum>()).ToDictionary(x => x.CashierId);
        var hours = (await multi.ReadAsync<HourRow>()).ToList();
        var pieces = (await multi.ReadAsync<HourRow>()).ToDictionary(x => x.Key, x => x.T);
        var terminals = (await multi.ReadAsync<PosRow>()).ToDictionary(x => x.Id);

        // كل كاشير يُنسب لصندوق واحد (الأكثر مبيعاً اليوم) كي لا تُحسب بطاقته مرتين
        var home = rows
            .Where(r => r.Acc > 0 && !skipAccounts.Contains(r.Acc) && r.CashierId > 0)
            .GroupBy(r => r.CashierId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.SalesTotal).First().Acc);

        var list = new List<CashierBoxLive>();
        foreach (var g in rows.Where(r => r.Acc > 0 && !skipAccounts.Contains(r.Acc)).GroupBy(r => r.Acc))
        {
            var box = new CashierBoxLive { Seq = g.Key };
            foreach (var r in g.OrderByDescending(r => r.SalesTotal))
            {
                if (!string.IsNullOrWhiteSpace(r.CashierName) && !box.Cashiers.Contains(r.CashierName.Trim())) box.Cashiers.Add(r.CashierName.Trim());
                box.Sales += r.Sales;
                box.SalesTotal += r.SalesTotal;
                box.Returns += r.Returns;
                box.ReturnsTotal += r.ReturnsTotal;
                box.Gifts += r.Gifts;
                box.Discount += r.Discount;
                if (r.FirstAt is { } f && (box.FirstAt is null || f < box.FirstAt)) box.FirstAt = f;
                if (r.LastAt is { } l && (box.LastAt is null || l > box.LastAt)) box.LastAt = l;
                if (box.Pos is null && r.PosId > 0 && terminals.TryGetValue(r.PosId, out var t))
                {
                    // أسماء نقاط البيع التلقائية (win:…) لا تعني شيئاً للمدير
                    box.Pos = string.IsNullOrWhiteSpace(t.Name) || t.Name.StartsWith("win:", StringComparison.OrdinalIgnoreCase) || t.Name.StartsWith("host:", StringComparison.OrdinalIgnoreCase) ? $"نقطة بيع {t.Id}" : t.Name.Trim();
                    box.Section = t.Section;
                    box.LastSeen = t.LastSeen;
                    box.Online = t.LastSeen is { } seen && DateTime.Now - seen < TimeSpan.FromMinutes(3);
                }
                if (home.GetValueOrDefault(r.CashierId) != g.Key) continue;
                if (cards.TryGetValue(r.CashierId, out var card))
                {
                    box.CardCount += card.N;
                    box.CardTotal += card.T;
                }
                if (voids.TryGetValue(r.CashierId, out var v))
                {
                    box.Voids += v.N;
                    box.VoidsAmount += v.T;
                }
                foreach (var h in hours.Where(h => h.Key == r.CashierId && h.H is >= 0 and < 24)) box.Hours[h.H] += h.T;
            }
            box.Cash = box.SalesTotal - box.ReturnsTotal;
            box.Total = box.Cash + box.CardTotal;
            box.Pieces = pieces.GetValueOrDefault(g.Key);
            if (box.Sales + box.Returns + box.Gifts > 0) list.Add(box);
        }
        return list.OrderByDescending(b => b.Online).ThenByDescending(b => b.LastAt).ToList();
    }

    private const string Where = "r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0";
    private const string Net = "CASE WHEN r.kind = 1 THEN -r.total_amount WHEN r.kind = 0 THEN r.total_amount ELSE 0 END";
    private const string LineNet = "CASE WHEN r.kind = 1 THEN -ri.quantity * ri.price WHEN r.kind = 0 THEN ri.quantity * ri.price ELSE 0 END";
    private const string LineQty = "CASE WHEN r.kind = 1 THEN -ri.quantity WHEN r.kind = 0 THEN ri.quantity ELSE 0 END";

    public async Task<SalesDayPack> BuildDayAsync(DateTime date, int productLimit, CancellationToken ct)
    {
        var sql = $"""
            SELECT CAST(COALESCE(SUM({Net}),0) AS DECIMAL(18,2)) AS Net,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN r.total_amount ELSE 0 END),0) AS DECIMAL(18,2)) AS Gross,
                   COALESCE(SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END),0) AS Receipts,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN r.total_amount ELSE 0 END),0) AS DECIMAL(18,2)) AS ReturnsTotal,
                   COALESCE(SUM(CASE WHEN r.kind = 1 THEN 1 ELSE 0 END),0) AS ReturnsCount,
                   COALESCE(SUM(CASE WHEN r.kind = 2 THEN 1 ELSE 0 END),0) AS Gifts,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN COALESCE(r.offers_discount,0) ELSE 0 END),0) AS DECIMAL(18,2)) AS OffersDiscount,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN COALESCE(r.user_discount,0) ELSE 0 END),0) AS DECIMAL(18,2)) AS UserDiscount,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN COALESCE(r.items_discount,0) ELSE 0 END),0) AS DECIMAL(18,2)) AS ItemsDiscount,
                   MIN(CASE WHEN r.kind = 0 THEN r.creation_date END) AS FirstAt,
                   MAX(CASE WHEN r.kind = 0 THEN r.creation_date END) AS LastAt
            FROM reciepts r WHERE {Where};

            SELECT CAST(COALESCE(SUM({LineQty}),0) AS DECIMAL(18,3))
            FROM reciept_items ri INNER JOIN reciepts r ON r.id = ri.reciept_id WHERE {Where};

            SELECT CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -cc.amount ELSE cc.amount END),0) AS DECIMAL(18,2)) AS CardTotal,
                   COUNT(cc.reciept_id) AS CardCount
            FROM reciepts r
            OUTER APPLY (SELECT TOP 1 k.reciept_id, CAST(k.amount AS DECIMAL(18,2)) AS amount FROM reciept_credit_card k WHERE k.reciept_id = r.id ORDER BY k.id DESC) cc
            WHERE {Where} AND r.kind IN (0,1) AND cc.reciept_id IS NOT NULL;

            SELECT DATEPART(hour, r.creation_date) AS H, CAST(COALESCE(SUM({Net}),0) AS DECIMAL(18,2)) AS T,
                   SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END) AS N
            FROM reciepts r WHERE {Where} AND r.kind IN (0,1)
            GROUP BY DATEPART(hour, r.creation_date);

            SELECT CAST(COALESCE(sec.id, 0) AS BIGINT) AS Id, COALESCE(sec.name, N'بلا قسم') AS Name, CAST(NULL AS NVARCHAR(200)) AS Sub,
                   CAST(COALESCE(SUM({Net}),0) AS DECIMAL(18,2)) AS T, SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END) AS N,
                   CAST(0 AS DECIMAL(18,3)) AS Q, MAX(CASE WHEN r.kind = 0 THEN r.creation_date END) AS LastAt
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            WHERE {Where} AND r.kind IN (0,1)
            GROUP BY sec.id, sec.name ORDER BY T DESC;

            SELECT CAST(COALESCE(r.point_of_sale_id, 0) AS BIGINT) AS Id, COALESCE(MAX(pos.name), N'—') AS Name, MAX(sec.name) AS Sub,
                   CAST(COALESCE(SUM({Net}),0) AS DECIMAL(18,2)) AS T, SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END) AS N,
                   CAST(0 AS DECIMAL(18,3)) AS Q, MAX(CASE WHEN r.kind = 0 THEN r.creation_date END) AS LastAt
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            WHERE {Where} AND r.kind IN (0,1)
            GROUP BY COALESCE(r.point_of_sale_id, 0) ORDER BY T DESC;

            SELECT CAST(COALESCE(r.cashier_id, 0) AS BIGINT) AS Id,
                   COALESCE(MAX(NULLIF(LTRIM(RTRIM(c.account_name)), N'')), MAX(c.username), N'—') AS Name, MAX(sec.name) AS Sub,
                   CAST(COALESCE(SUM({Net}),0) AS DECIMAL(18,2)) AS T, SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END) AS N,
                   CAST(SUM(CASE WHEN r.kind = 1 THEN 1 ELSE 0 END) AS DECIMAL(18,3)) AS Q,
                   MAX(CASE WHEN r.kind = 0 THEN r.creation_date END) AS LastAt,
                   CAST(COALESCE(SUM(CASE WHEN r.kind = 0 THEN COALESCE(r.user_discount,0) ELSE 0 END),0) AS DECIMAL(18,2)) AS D
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            WHERE {Where} AND r.kind IN (0,1)
            GROUP BY COALESCE(r.cashier_id, 0) ORDER BY T DESC;

            SELECT CAST(COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) AS BIGINT) AS Id,
                   COALESCE(MAX(s.name), MAX(NULLIF(LTRIM(RTRIM(ri.salesman_name)), N'')), N'بلا بائع') AS Name, CAST(NULL AS NVARCHAR(200)) AS Sub,
                   CAST(COALESCE(SUM({LineNet}),0) AS DECIMAL(18,2)) AS T,
                   COUNT(DISTINCT CASE WHEN r.kind = 0 THEN r.id END) AS N,
                   CAST(COALESCE(SUM({LineQty}),0) AS DECIMAL(18,3)) AS Q,
                   MAX(CASE WHEN r.kind = 0 THEN r.creation_date END) AS LastAt
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN salesmen s ON s.id = COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0)
            WHERE {Where} AND r.kind IN (0,1)
            GROUP BY COALESCE(NULLIF(ri.salesman_id, 0), r.salesman, 0) ORDER BY T DESC;

            SELECT TOP (@productLimit) CAST(ri.article_id AS BIGINT) AS Id,
                   COALESCE(MAX(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1)))), N'—') AS Name,
                   COALESCE(MAX(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), a.Barcode))), N'')), MAX(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(200), ri.barcode))), N''))) AS Barcode,
                   CAST(COALESCE(SUM({LineQty}),0) AS DECIMAL(18,3)) AS Q,
                   CAST(COALESCE(SUM({LineNet}),0) AS DECIMAL(18,2)) AS T,
                   COUNT(DISTINCT CASE WHEN r.kind = 0 THEN r.id END) AS N
            FROM reciept_items ri
            INNER JOIN reciepts r ON r.id = ri.reciept_id
            LEFT JOIN articles a ON a.id = ri.article_id
            WHERE {Where} AND r.kind IN (0,1)
            GROUP BY ri.article_id ORDER BY T DESC;

            SELECT CAST(v.cashier_id AS BIGINT) AS Id,
                   COALESCE(MAX(NULLIF(LTRIM(RTRIM(c.account_name)), N'')), MAX(c.username), N'—') AS Name,
                   COUNT(*) AS V, CAST(COALESCE(SUM(v.amount),0) AS DECIMAL(18,2)) AS Va
            FROM ext_cashier_voids v
            LEFT JOIN cashiers c ON c.id = v.cashier_id
            WHERE v.created_at >= @day AND v.created_at < @next
            GROUP BY v.cashier_id;
            """;
        var day = date.Date;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            sql, new { day, next = day.AddDays(1), productLimit = Math.Clamp(productLimit, 5, 200) }, commandTimeout: 90, cancellationToken: ct));
        var totals = await multi.ReadSingleAsync<SalesDayTotals>();
        totals.Pieces = await multi.ReadSingleAsync<decimal>();
        var card = await multi.ReadSingleAsync<SalesDayTotals>();
        totals.CardTotal = card.CardTotal;
        totals.CardCount = card.CardCount;
        var hours = (await multi.ReadAsync<SalesHour>()).OrderBy(h => h.H).ToList();
        var sections = (await multi.ReadAsync<SalesNamed>()).ToList();
        var terminals = (await multi.ReadAsync<SalesNamed>()).ToList();
        var cashiers = (await multi.ReadAsync<SalesNamed>()).ToList();
        var sellers = (await multi.ReadAsync<SalesNamed>()).ToList();
        var products = (await multi.ReadAsync<SalesProduct>()).ToList();
        foreach (var v in await multi.ReadAsync<SalesNamed>())
        {
            var c = cashiers.FirstOrDefault(x => x.Id == v.Id);
            if (c is null)
            {
                // كاشير حذف مواد ولم يُصدر فاتورة
                c = new SalesNamed { Id = v.Id, Name = v.Name };
                cashiers.Add(c);
            }
            c.V = v.V;
            c.Va = v.Va;
        }
        return new SalesDayPack(day.ToString("yyyy-MM-dd"), totals, hours, sections, terminals, cashiers, sellers, products);
    }

    /// <summary>آخر الفواتير (للبث المباشر): الأحدث أولاً.</summary>
    public async Task<IReadOnlyList<SalesReceipt>> RecentAsync(DateTime date, int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit) r.id AS Id, CAST(COALESCE(r.number, 0) AS BIGINT) AS Number, r.creation_date AS At, r.kind AS Kind,
                   CAST(COALESCE(r.total_amount, 0) AS DECIMAL(18,2)) AS Total,
                   (SELECT COUNT(*) FROM reciept_items i WHERE i.reciept_id = r.id) AS Items,
                   COALESCE(NULLIF(LTRIM(RTRIM(c.account_name)), N''), c.username) AS Cashier,
                   pos.name AS Pos,
                   s.name AS Seller,
                   CAST(CASE WHEN EXISTS (SELECT 1 FROM reciept_credit_card k WHERE k.reciept_id = r.id) THEN 1 ELSE 0 END AS BIT) AS Card
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN salesmen s ON s.id = r.salesman
            WHERE r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0
            ORDER BY r.creation_date DESC, r.id DESC
            """;
        var day = date.Date;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<SalesReceipt>(new CommandDefinition(
            sql, new { day, next = day.AddDays(1), limit = Math.Clamp(limit, 1, 100) }, cancellationToken: ct))).ToList();
    }

    /// <summary>نقاط البيع وحالة اتصالها (آخر نبضة) وآخر بيع اليوم.</summary>
    public async Task<IReadOnlyList<SalesTerminal>> TerminalsAsync(DateTime date, CancellationToken ct)
    {
        const string sql = """
            SELECT CAST(p.id AS BIGINT) AS Id, COALESCE(p.name, N'—') AS Name, s.name AS Section, p.last_connection AS LastSeen,
                   (SELECT MAX(r.creation_date) FROM reciepts r WHERE r.point_of_sale_id = p.id AND r.creation_date >= @day AND r.creation_date < @next AND r.is_pending = 0) AS LastSaleAt,
                   CAST(COALESCE(p.state, 0) AS BIT) AS Active
            FROM point_of_sales p LEFT JOIN sections s ON s.id = p.section_id
            WHERE COALESCE(p.is_deleted, 0) = 0
            ORDER BY p.name
            """;
        var day = date.Date;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<SalesTerminal>(new CommandDefinition(sql, new { day, next = day.AddDays(1) }, cancellationToken: ct))).ToList();
    }

    /// <summary>إجماليات كل يوم في المدة (للاتجاهات الطويلة).</summary>
    public async Task<IReadOnlyList<SalesDailyRow>> DailyAsync(DateTime from, DateTime to, CancellationToken ct)
    {
        const string sql = """
            SELECT CONVERT(CHAR(10), d.Day, 23) AS Day, d.Net, d.Receipts, d.ReturnsTotal, COALESCE(q.Pieces, 0) AS Pieces
            FROM (
                SELECT CAST(r.creation_date AS date) AS Day,
                       CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN -r.total_amount WHEN r.kind = 0 THEN r.total_amount ELSE 0 END),0) AS DECIMAL(18,2)) AS Net,
                       SUM(CASE WHEN r.kind = 0 THEN 1 ELSE 0 END) AS Receipts,
                       CAST(COALESCE(SUM(CASE WHEN r.kind = 1 THEN r.total_amount ELSE 0 END),0) AS DECIMAL(18,2)) AS ReturnsTotal
                FROM reciepts r
                WHERE r.creation_date >= @from AND r.creation_date < @to AND r.is_pending = 0 AND r.kind IN (0,1)
                GROUP BY CAST(r.creation_date AS date)
            ) d
            LEFT JOIN (
                SELECT CAST(r.creation_date AS date) AS Day,
                       CAST(SUM(CASE WHEN r.kind = 1 THEN -ri.quantity ELSE ri.quantity END) AS DECIMAL(18,3)) AS Pieces
                FROM reciept_items ri INNER JOIN reciepts r ON r.id = ri.reciept_id
                WHERE r.creation_date >= @from AND r.creation_date < @to AND r.is_pending = 0 AND r.kind IN (0,1)
                GROUP BY CAST(r.creation_date AS date)
            ) q ON q.Day = d.Day
            ORDER BY d.Day
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<SalesDailyRow>(new CommandDefinition(
            sql, new { from = from.Date, to = to.Date.AddDays(1) }, commandTimeout: 120, cancellationToken: ct))).ToList();
    }

}
