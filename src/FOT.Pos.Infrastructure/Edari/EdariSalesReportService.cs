using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>مبيعات / هدايا / مردود لمجموعة مواد — كما يصنّفها الإداري حسب نوع الفاتورة.</summary>
public sealed record SalesCatDto(
    decimal SalesQty,
    decimal Sales,
    // القطع المهداة: فواتير الهدايا + البونص المسجّل على فواتير البيع.
    decimal GiftsQty,
    decimal Gifts,
    decimal ReturnsQty,
    decimal Returns,
    // الصافي = المبيعات − المردود.
    decimal Net);

public sealed record SalesDayDto(string Date, decimal Sales, decimal Returns, decimal Gifts, decimal Net, int Invoices);

public sealed record SalesBranchDto(string Code, string Label, bool Numbered, decimal Sales, decimal Returns, decimal Gifts, decimal Net, int Invoices);

public sealed record SalesNodeRefDto(long Seq, string Num, string Name);

/// <summary>شجرة مواد (ماركة/مجموعة) أو مادة، بمبيعاتها في الفترة.</summary>
public sealed record SalesItemDto(
    long Seq,
    string Num,
    string Name,
    bool Leaf,
    string? Barcode,
    // اسم الشجرة الأم (يُملأ في قوائم المواد والبحث).
    string? Tree,
    // شجرة خارج إجمالي النظام (عمولات، مواد مجرودة… رقمها 1000 فأكثر).
    bool Excluded,
    decimal SalesQty,
    decimal Sales,
    decimal GiftsQty,
    decimal Gifts,
    decimal ReturnsQty,
    decimal Returns,
    decimal Net);

public sealed record SalesLineDto(
    string Date,
    string InvNum,
    int Kind,
    string KindLabel,
    string Branch,
    string? Account,
    string? Seller,
    long Mat,
    string MatNum,
    string MatName,
    decimal Qty,
    decimal Bonus,
    decimal Price,
    // موجب للبيع والهدية، سالب للمردود.
    decimal Total);

public sealed record EdariSalesReportDto(
    string From,
    string To,
    DateTime At,
    IReadOnlyList<string> BranchFilter,
    SalesCatDto Totals,
    int Invoices,
    // صافي الأشجار المستثناة من الإجمالي (بلا فلتر فروع فقط).
    decimal ExcludedNet,
    IReadOnlyList<SalesDayDto> Days,
    IReadOnlyList<SalesBranchDto> Branches,
    SalesNodeRefDto? Node,
    IReadOnlyList<SalesNodeRefDto> Path,
    SalesCatDto NodeTotals,
    IReadOnlyList<SalesItemDto> Items,
    IReadOnlyList<SalesItemDto> TopMaterials,
    IReadOnlyList<SalesLineDto>? Lines,
    bool LinesTruncated,
    string? Search);

public sealed record EdariSalesQuery(
    DateTime From,
    DateTime To,
    IReadOnlyList<string>? Branches = null,
    long? Node = null,
    string? Search = null,
    bool Lines = false,
    int MaxLines = 3000,
    bool Fresh = false);

/// <summary>
/// تقرير المبيعات من «إداري» مباشرة (قراءة فقط) — نفس حساب تقرير تطبيق الحسابات:
///  · المبيعات = بنود فواتير البيع (غير الهدايا والمردود) بكميتها × سعر الفاتورة (أو مجموع السطر المخزَّن).
///  · الهدايا = فواتير الهدايا (نوع 6) + البونص على فواتير البيع. المردود = فواتير النوع 2 و 5.
///  · إجمالي النظام بلا فلتر فروع يستثني الأشجار التي رقمها 1000 فأكثر (عمولات، مواد مجرودة…).
///  · الفرع من ملاحظات الفاتورة («الفرع 136») وإلا فمن رقم حساب الفاتورة (دلفري/كاشير…).
/// الفترة تُحسب باستعلامات مجمَّعة (لكل مادة ولكل فاتورة) ثم تُحفظ دقيقتين، فالتنقل بين الأشجار فوري.
/// </summary>
public sealed partial class EdariSalesReportService(EdariTextQueryService text)
{
    public const int MaxRangeDays = 93;
    private const int MaxLineLeaves = 1200;
    private const int Chunk = 400;
    private static readonly TimeSpan CatalogTtl = TimeSpan.FromMinutes(45);
    private static readonly TimeSpan AccountsTtl = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan PeriodTtl = TimeSpan.FromMinutes(2);

    private static readonly (string Code, bool Numbered)[] StandardBranches =
        [("136", true), ("138", true), ("1210413", false), ("1210420", false)];

    private const string AggSql = """
        SUM(CASE WHEN l.Quant > 0 THEN l.Quant ELSE 0 END),
        SUM(CASE WHEN l.Quant > 0 THEN (CASE WHEN l."sum" > 0 THEN l."sum" ELSE ROUND(l.Quant * l.Price) END) ELSE 0 END),
        SUM(CASE WHEN l."sum" > 0 THEN l."sum" WHEN l.Quant > 0 THEN ROUND(l.Quant * l.Price) ELSE ABS(ROUND(l.OBonus * l.Price)) END),
        SUM(ABS(l.Quant)),
        SUM(CASE WHEN l.OBonus > 0 THEN l.OBonus ELSE 0 END),
        SUM(CASE WHEN l.OBonus > 0 THEN ROUND(l.OBonus * l.Price) ELSE 0 END)
        """;

    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static Catalog? _catalog;
    private static DateTime _catalogAt;
    private static AccountBook? _accounts;
    private static DateTime _accountsAt;
    private static Dictionary<string, string>? _sellers;
    private static DateTime _sellersAt;
    private static readonly Dictionary<string, (DateTime At, Period Data)> Periods = [];

    /* ── التقرير ── */
    public async Task<EdariSalesReportDto> GetAsync(EdariSalesQuery q, CancellationToken ct)
    {
        var from = q.From.Date;
        var to = q.To.Date;
        if (to < from) (from, to) = (to, from);
        if ((to - from).TotalDays > MaxRangeDays)
            throw new ArgumentException($"أقصى فترة للتقرير {MaxRangeDays} يوماً — اختر فترة أقصر");

        var branches = (q.Branches ?? []).Select(Digits).Where(c => c.Length > 0).Distinct().OrderBy(c => c, StringComparer.Ordinal).ToList();
        var key = $"{Iso(from)}|{Iso(to)}|{string.Join(",", branches)}";

        Catalog catalog;
        Period period;
        await Gate.WaitAsync(ct);
        try
        {
            catalog = await LoadCatalogAsync(ct);
            if (!q.Fresh && Periods.TryGetValue(key, out var hit) && DateTime.Now - hit.At < PeriodTtl)
                period = hit.Data;
            else
            {
                period = await BuildPeriodAsync(catalog, from, to, branches, ct);
                Periods[key] = (DateTime.Now, period);
                foreach (var old in Periods.Where(p => DateTime.Now - p.Value.At > PeriodTtl).Select(p => p.Key).ToList()) Periods.Remove(old);
                while (Periods.Count > 24) Periods.Remove(Periods.MinBy(p => p.Value.At).Key);
            }
        }
        finally
        {
            Gate.Release();
        }

        // موضع التنقل في شجرة المواد
        Mat? node = null;
        if (q.Node is { } nodeSeq && nodeSeq > 0)
            node = catalog.BySeq.GetValueOrDefault(nodeSeq) ?? throw new KeyNotFoundException("شجرة المواد غير موجودة في الإداري");

        var path = new List<SalesNodeRefDto>();
        for (var cur = node; cur is not null; cur = cur.Father > 0 ? catalog.BySeq.GetValueOrDefault(cur.Father) : null)
        {
            path.Insert(0, new SalesNodeRefDto(cur.Seq, cur.Num, cur.Name));
            if (path.Count > 40) break;
        }

        var filtered = branches.Count > 0;
        var search = Normalize(q.Search);
        var words = search.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        List<SalesItemDto> items;
        if (search.Length > 0)
        {
            // بحث عن مادة لها حركة في الفترة (بالاسم أو الرقم أو الباركود) ضمن الموضع الحالي
            items = period.Mats
                .Select(kv => (Mat: catalog.BySeq.GetValueOrDefault(kv.Key), Agg: kv.Value))
                .Where(x => x.Mat is not null && x.Agg.Any && (node is null || IsUnder(catalog, x.Mat, node.Seq)) && words.All(w => x.Mat.SearchKey.Contains(w)))
                .OrderByDescending(x => x.Agg.SA).ThenByDescending(x => x.Agg.SQ)
                .Take(150)
                .Select(x => Item(catalog, x.Mat!, x.Agg, withTree: true, filtered))
                .ToList();
        }
        else if (node is { Leaf: true })
            items = [];
        else
        {
            var children = catalog.Children.GetValueOrDefault(node?.Seq ?? 0) ?? [];
            items = children
                .Select(c => (Mat: c, Agg: period.Nodes.GetValueOrDefault(c.Seq)))
                .Where(x => x.Agg.Any)
                .OrderBy(x => !filtered && x.Mat.Excluded)
                .ThenByDescending(x => x.Agg.Net).ThenByDescending(x => x.Agg.SA).ThenByDescending(x => x.Agg.GA)
                .Select(x => Item(catalog, x.Mat, x.Agg, withTree: false, filtered))
                .ToList();
        }

        // أكثر المواد مبيعاً ضمن الموضع
        var top = node is { Leaf: true }
            ? []
            : period.Mats
                .Select(kv => (Mat: catalog.BySeq.GetValueOrDefault(kv.Key), Agg: kv.Value))
                .Where(x => x.Mat is not null && x.Agg.SA > 0
                    && (node is not null ? IsUnder(catalog, x.Mat, node.Seq) : filtered || !x.Mat.Excluded))
                .OrderByDescending(x => x.Agg.SA).ThenByDescending(x => x.Agg.SQ)
                .Take(40)
                .Select(x => Item(catalog, x.Mat!, x.Agg, withTree: true, filtered))
                .ToList();

        var nodeAgg = node is null ? period.Totals : period.Nodes.GetValueOrDefault(node.Seq);

        IReadOnlyList<SalesLineDto>? lines = null;
        var truncated = false;
        if (q.Lines && node is not null)
        {
            var leaves = LeavesUnder(catalog, node, MaxLineLeaves + 1);
            if (leaves.Count > MaxLineLeaves)
                throw new ArgumentException("الشجرة كبيرة جداً لعرض حركاتها — ادخل إلى مجموعة أصغر أو مادة");
            (lines, truncated) = await LoadLinesAsync(catalog, leaves, from, to, branches, Math.Clamp(q.MaxLines, 50, 6000), ct);
        }

        return new EdariSalesReportDto(
            Iso(from), Iso(to), period.At, branches,
            period.Totals.ToDto(), period.InvoiceCount, period.ExcludedNet,
            period.Days, period.Branches,
            node is null ? null : new SalesNodeRefDto(node.Seq, node.Num, node.Name), path,
            nodeAgg.ToDto(), items, top, lines, truncated,
            string.IsNullOrWhiteSpace(q.Search) ? null : q.Search.Trim());
    }

    private static SalesItemDto Item(Catalog catalog, Mat m, Agg a, bool withTree, bool filtered)
    {
        string? tree = null;
        if (withTree && m.Father > 0 && catalog.BySeq.TryGetValue(m.Father, out var parent)) tree = parent.Name;
        return new SalesItemDto(m.Seq, m.Num, m.Name, m.Leaf, m.Leaf && m.Barcode.Length > 0 ? m.Barcode : null, tree,
            !filtered && m.Excluded, a.SQ, a.SA, a.GQ, a.GA, a.RQ, a.RA, a.Net);
    }

    /* ── بيانات الفترة ── */
    private struct Agg
    {
        public decimal SQ, SA, GQ, GA, RQ, RA;

        public readonly decimal Net => SA - RA;
        public readonly bool Any => SQ != 0 || SA != 0 || GQ != 0 || GA != 0 || RQ != 0 || RA != 0;

        public void Add(in Agg o)
        {
            SQ += o.SQ;
            SA += o.SA;
            GQ += o.GQ;
            GA += o.GA;
            RQ += o.RQ;
            RA += o.RA;
        }

        public void Sub(in Agg o)
        {
            SQ -= o.SQ;
            SA -= o.SA;
            GQ -= o.GQ;
            GA -= o.GA;
            RQ -= o.RQ;
            RA -= o.RA;
        }

        public readonly SalesCatDto ToDto() => new(SQ, SA, GQ, GA, RQ, RA, Net);

        /// <summary>صف مجمَّع (أعمدة AggSql بدءاً من at) لنوع فاتورة واحد.</summary>
        public static Agg FromRow(int kind, string?[] r, int at)
        {
            decimal q = Num(Cell(r, at)), a = Num(Cell(r, at + 1)), t = Num(Cell(r, at + 2)),
                aq = Num(Cell(r, at + 3)), b = Num(Cell(r, at + 4)), ba = Num(Cell(r, at + 5));
            return kind switch
            {
                6 => new Agg { GQ = aq, GA = Math.Abs(t) },
                2 or 5 => new Agg { RQ = aq, RA = Math.Abs(t) },
                _ => new Agg { SQ = q, SA = a, GQ = b, GA = ba },
            };
        }
    }

    private sealed class Invoice
    {
        public long Seq;
        public string Num = "";
        public int Kind;
        public DateTime Date;
        public long Acc;
        public string Remarks = "";
        public string BranchCode = "";
        public bool Numbered;
        public bool Marked;
        public Agg Agg;
    }

    private sealed class Period
    {
        public DateTime At = DateTime.Now;
        public Dictionary<long, Invoice> Invoices = [];
        public Dictionary<long, Agg> Mats = [];
        public Dictionary<long, Agg> Nodes = [];
        public Agg Totals;
        public decimal ExcludedNet;
        public int InvoiceCount;
        public List<SalesDayDto> Days = [];
        public List<SalesBranchDto> Branches = [];
    }

    private async Task<Period> BuildPeriodAsync(Catalog catalog, DateTime from, DateTime to, List<string> branches, CancellationToken ct)
    {
        var book = await LoadAccountsAsync(ct);
        var range = $"""i."Date" >= {Ts(from)} AND i."Date" < {Ts(to.AddDays(1))} AND i.Kind <> 3""";
        const string join = "FROM file14n l INNER JOIN File15n i ON i.Seq = l.BillSeq";
        var p = new Period();

        // 1) كل فواتير الفترة بمجاميعها (كل المواد)
        var invRows = await Query($"""
            SELECT i.Seq, i.Num, i.Kind, i."Date", i.Two, i.remarks, {AggSql}
            {join}
            WHERE {range}
            GROUP BY i.Seq, i.Num, i.Kind, i."Date", i.Two, i.remarks
            """, ct);
        var all = new List<Invoice>();
        foreach (var r in invRows)
        {
            var date = ParseDate(Cell(r, 3));
            if (date is null) continue;
            var inv = new Invoice
            {
                Seq = (long)Num(Cell(r, 0)),
                Num = Cell(r, 1)?.Trim() ?? "",
                Kind = (int)Num(Cell(r, 2)),
                Date = date.Value,
                Acc = (long)Num(Cell(r, 4)),
                Remarks = Cell(r, 5)?.Trim() ?? "",
            };
            inv.Agg = Agg.FromRow(inv.Kind, r, 6);
            var number = RemarksBranchNumber(inv.Remarks);
            inv.Marked = number is not null;
            inv.Numbered = !string.IsNullOrEmpty(number);
            inv.BranchCode = inv.Numbered ? number! : book.BySeq.GetValueOrDefault(inv.Acc)?.Code ?? "";
            all.Add(inv);
        }

        var filtered = branches.Count > 0;
        var scope = filtered ? all.Where(i => branches.Contains(i.BranchCode)).ToList() : all;
        foreach (var inv in scope) p.Invoices[inv.Seq] = inv;
        p.InvoiceCount = scope.Count;

        // 2) المواد: مجمَّعة لكل مادة ونوع فاتورة (مع فلتر الفروع: فواتير الفروع المحددة فقط)
        var matRows = new List<string?[]>();
        if (!filtered)
        {
            matRows.AddRange(await Query($"SELECT l.Mat, i.Kind, {AggSql} {join} WHERE {range} GROUP BY l.Mat, i.Kind", ct));
        }
        else
        {
            foreach (var part in scope.Select(i => i.Seq).Chunk(800))
                matRows.AddRange(await Query($"SELECT l.Mat, i.Kind, {AggSql} {join} WHERE {range} AND l.BillSeq IN ({string.Join(",", part)}) GROUP BY l.Mat, i.Kind", ct));
        }
        foreach (var r in matRows)
        {
            var mat = (long)Num(Cell(r, 0));
            var agg = Agg.FromRow((int)Num(Cell(r, 1)), r, 2);
            var cur = p.Mats.GetValueOrDefault(mat);
            cur.Add(agg);
            p.Mats[mat] = cur;
        }

        // مجاميع كل شجرة = مجموع موادها (صعوداً حتى الجذر)
        Agg everything = default, excluded = default;
        foreach (var (matSeq, agg) in p.Mats)
        {
            everything.Add(agg);
            var m = catalog.BySeq.GetValueOrDefault(matSeq);
            if (m is null) continue;
            if (m.Excluded) excluded.Add(agg);
            var guard = 0;
            for (var cur = m; cur is not null && guard++ < 40; cur = cur.Father > 0 ? catalog.BySeq.GetValueOrDefault(cur.Father) : null)
            {
                var sum = p.Nodes.GetValueOrDefault(cur.Seq);
                sum.Add(agg);
                p.Nodes[cur.Seq] = sum;
            }
        }
        p.Totals = everything;
        if (!filtered)
        {
            p.Totals.Sub(excluded);
            p.ExcludedNet = excluded.Net;
        }

        // 3) بلا فلتر: حصة الأشجار المستثناة من كل فاتورة، لتطابق الأيام الإجمالي
        var excludedByInvoice = new Dictionary<long, Agg>();
        if (!filtered && excluded.Any)
        {
            var parents = catalog.BySeq.Values.Where(m => m.Excluded && !m.Leaf).Select(m => m.Seq).ToList();
            var rootLeaves = catalog.BySeq.Values.Where(m => m.Excluded && m.Leaf && m.Father == 0).Select(m => m.Seq).ToList();
            var conditions = parents.Chunk(Chunk).Select(c => $"m.Father IN ({string.Join(",", c)})")
                .Concat(rootLeaves.Chunk(Chunk).Select(c => $"l.Mat IN ({string.Join(",", c)})"));
            foreach (var condition in conditions)
            {
                var rows = await Query($"""
                    SELECT i.Seq, i.Kind, {AggSql}
                    {join} INNER JOIN File13n m ON m.Seq = l.Mat
                    WHERE {range} AND {condition}
                    GROUP BY i.Seq, i.Kind
                    """, ct);
                foreach (var r in rows)
                {
                    var seq = (long)Num(Cell(r, 0));
                    var cur = excludedByInvoice.GetValueOrDefault(seq);
                    cur.Add(Agg.FromRow((int)Num(Cell(r, 1)), r, 2));
                    excludedByInvoice[seq] = cur;
                }
            }
        }

        // الأيام
        var days = new SortedDictionary<DateTime, (Agg Agg, int Invoices)>();
        for (var d = from; d <= to; d = d.AddDays(1)) days[d] = default;
        foreach (var inv in scope)
        {
            if (!days.TryGetValue(inv.Date, out var cur)) continue;
            var agg = inv.Agg;
            if (excludedByInvoice.TryGetValue(inv.Seq, out var ex)) agg.Sub(ex);
            cur.Agg.Add(agg);
            cur.Invoices++;
            days[inv.Date] = cur;
        }
        p.Days = days.Select(d => new SalesDayDto(Iso(d.Key), d.Value.Agg.SA, d.Value.Agg.RA, d.Value.Agg.GA, d.Value.Agg.Net, d.Value.Invoices)).ToList();

        // الفروع (من كل فواتير الفترة حتى يبقى الفلتر قابلاً للتبديل) — بكل المواد كما في الإداري
        // الفرع المعروف: له فاتورة تحمل «الفرع» في الملاحظات، أو معتمد، أو محدد في الفلتر.
        // فواتير الحساب نفسه بلا ملاحظة (مردود الكاشير مثلاً) تتبع فرعه؛ وما عداها (حسابات الزبائن…) يُجمع في سطر واحد.
        var known = new HashSet<string>(all.Where(i => i.Marked && i.BranchCode.Length > 0).Select(i => i.BranchCode));
        foreach (var (code, _) in StandardBranches) known.Add(code);
        foreach (var code in branches) known.Add(code);
        var groups = new Dictionary<string, BranchAcc>();
        foreach (var inv in all)
        {
            var code = known.Contains(inv.BranchCode) ? inv.BranchCode : "";
            if (!groups.TryGetValue(code, out var g))
            {
                groups[code] = g = new BranchAcc { Code = code, Numbered = book.ByCode.ContainsKey(code) && all.Any(i => i.BranchCode == code && i.Numbered) };
                if (code.Length > 0)
                    g.Name = (g.Numbered ? book.ByCode.GetValueOrDefault(code) : book.BySeq.GetValueOrDefault(inv.Acc))?.Name ?? book.ByCode.GetValueOrDefault(code)?.Name ?? "";
            }
            g.Agg.Add(inv.Agg);
            g.Invoices++;
            var word = RemarksBranchWord(inv.Remarks);
            if (word.Length > 0) g.Words[word] = g.Words.GetValueOrDefault(word) + 1;
        }
        foreach (var (code, numbered) in StandardBranches)
            if (!groups.ContainsKey(code))
                groups[code] = new BranchAcc { Code = code, Numbered = numbered, Name = book.ByCode.GetValueOrDefault(code)?.Name ?? "" };

        p.Branches = groups.Values
            .OrderBy(g => g.Code.Length == 0 ? 3 : g.Numbered || g.Code.Length <= 4 ? 0 : 1)
            .ThenByDescending(g => g.Agg.Net).ThenByDescending(g => g.Invoices).ThenBy(g => g.Code, StringComparer.Ordinal)
            .Select(g =>
            {
                string label;
                if (g.Code.Length == 0) label = "بدون فرع (حسابات أخرى)";
                else
                {
                    // كلمة الفرع تُضاف للاسم فقط إن كانت غالبة (80٪ فأكثر من فواتير الحساب)
                    var topWord = g.Words.OrderByDescending(w => w.Value).FirstOrDefault();
                    var dominant = topWord.Key is not null && topWord.Value >= 0.8 * g.Invoices ? topWord.Key : null;
                    label = ComposeBranchLabel(g.Code, g.Numbered, g.Name, dominant);
                }
                return new SalesBranchDto(g.Code, label, g.Numbered, g.Agg.SA, g.Agg.RA, g.Agg.GA, g.Agg.Net, g.Invoices);
            })
            .ToList();
        return p;
    }

    private sealed class BranchAcc
    {
        public string Code = "";
        public bool Numbered;
        public string Name = "";
        public Agg Agg;
        public int Invoices;
        public Dictionary<string, int> Words = [];
    }

    /// <summary>يبقي شجرة المواد جاهزة في الذاكرة (قراءتها تأخذ ثوانيَ) كي لا ينتظرها أول من يفتح التقرير.</summary>
    public async Task WarmAsync(CancellationToken ct)
    {
        if (_catalog is not null && DateTime.Now - _catalogAt < CatalogTtl - TimeSpan.FromMinutes(5)) return;
        await Gate.WaitAsync(ct);
        try
        {
            _catalogAt = _catalog is null ? _catalogAt : DateTime.MinValue;
            await LoadCatalogAsync(ct);
        }
        finally
        {
            Gate.Release();
        }
    }

    /* ── بنود الفواتير لمادة أو مجموعة صغيرة ── */
    private async Task<(IReadOnlyList<SalesLineDto>, bool)> LoadLinesAsync(
        Catalog catalog, List<long> leaves, DateTime from, DateTime to, List<string> branches, int max, CancellationToken ct)
    {
        var book = await LoadAccountsAsync(ct);
        var sellers = await LoadSellersAsync(ct);
        var range = $"""i."Date" >= {Ts(from)} AND i."Date" < {Ts(to.AddDays(1))} AND i.Kind <> 3""";
        var seen = new HashSet<long>();
        var raw = new List<(DateTime Date, string InvNum, long LineSeq, SalesLineDto Line)>();
        foreach (var part in leaves.Chunk(Chunk))
        {
            var rows = await Query($"""
                SELECT l.Seq, l.Mat, l.Quant, l.Price, l.OBonus, l."sum", l.person, i.Num, i.Kind, i."Date", i.Two, i.remarks
                FROM file14n l INNER JOIN File15n i ON i.Seq = l.BillSeq
                WHERE {range} AND l.Mat IN ({string.Join(",", part)})
                """, ct);
            foreach (var r in rows)
            {
                var lineSeq = (long)Num(Cell(r, 0));
                if (lineSeq > 0 && !seen.Add(lineSeq)) continue;
                var date = ParseDate(Cell(r, 9));
                if (date is null) continue;
                var kind = (int)Num(Cell(r, 8));
                var remarks = Cell(r, 11)?.Trim() ?? "";
                var acc = book.BySeq.GetValueOrDefault((long)Num(Cell(r, 10)));
                var number = RemarksBranchNumber(remarks);
                var numbered = !string.IsNullOrEmpty(number);
                var code = numbered ? number! : acc?.Code ?? "";
                if (branches.Count > 0 && !branches.Contains(code)) continue;

                var matSeq = (long)Num(Cell(r, 1));
                var mat = catalog.BySeq.GetValueOrDefault(matSeq);
                decimal qty = Num(Cell(r, 2)), price = Num(Cell(r, 3)), bonus = Num(Cell(r, 4)), stored = Num(Cell(r, 5));
                var total = stored > 0 ? stored : Math.Abs(qty > 0 ? Math.Round(qty * price) : Math.Round(bonus * price));
                var isGift = kind == 6;
                var isReturn = kind is 2 or 5;
                var person = Cell(r, 6)?.Trim() ?? "";
                var branch = numbered
                    ? ComposeBranchLabel(code, true, book.ByCode.GetValueOrDefault(code)?.Name ?? "", null)
                    : ComposeBranchLabel(code, false, acc?.Name ?? "", RemarksBranchWord(remarks) is { Length: > 0 } w ? w : null);
                var invNum = Cell(r, 7)?.Trim() ?? "";
                raw.Add((date.Value, invNum, lineSeq, new SalesLineDto(
                    Iso(date.Value), invNum, kind, isGift ? "هدية" : isReturn ? "مرتجع" : "مبيعات",
                    branch, acc?.Name, sellers.GetValueOrDefault(person),
                    matSeq, mat?.Num ?? "", mat?.Name ?? "", qty, bonus, price, isReturn ? -total : total)));
            }
        }
        var ordered = raw
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => long.TryParse(x.InvNum, out var n) ? n : 0)
            .ThenBy(x => x.LineSeq)
            .Select(x => x.Line)
            .ToList();
        return ordered.Count > max ? (ordered.Take(max).ToList(), true) : (ordered, false);
    }

    /* ── شجرة المواد ── */
    private sealed class Mat
    {
        public long Seq;
        public string Num = "";
        public string Name = "";
        public long Father;
        public bool Leaf;
        public string Barcode = "";
        public bool Excluded;
        public string SearchKey = "";
    }

    private sealed class Catalog
    {
        public Dictionary<long, Mat> BySeq = [];
        public Dictionary<long, List<Mat>> Children = [];
    }

    private async Task<Catalog> LoadCatalogAsync(CancellationToken ct)
    {
        if (_catalog is not null && DateTime.Now - _catalogAt < CatalogTtl) return _catalog;
        var rows = await text.QueryAsync("SELECT Seq, Num, Name1, Father, SubCount, Barcode FROM File13n", ct);
        if (!text.LastCallSucceeded || rows.Count == 0)
        {
            // شجرة قديمة أفضل من لا شيء إن انقطع الإداري لحظة
            if (_catalog is not null) return _catalog;
            throw new InvalidOperationException("تعذر قراءة شجرة المواد من الإداري — تأكد أن خادم الإداري يعمل");
        }

        var c = new Catalog();
        foreach (var r in rows)
        {
            var m = new Mat
            {
                Seq = (long)Num(Cell(r, 0)),
                Num = Cell(r, 1)?.Trim() ?? "",
                Name = Cell(r, 2)?.Trim() ?? "",
                Father = (long)Num(Cell(r, 3)),
                Leaf = Num(Cell(r, 4)) <= 0,
                Barcode = Cell(r, 5)?.Trim() ?? "",
            };
            if (m.Seq <= 0) continue;
            m.SearchKey = Normalize($"{m.Num} {m.Barcode} {m.Name}");
            c.BySeq[m.Seq] = m;
        }
        foreach (var m in c.BySeq.Values)
        {
            // أب مفقود = جذر
            var parent = m.Father > 0 && c.BySeq.ContainsKey(m.Father) ? m.Father : 0;
            if (parent == 0) m.Father = 0;
            if (!c.Children.TryGetValue(parent, out var list)) c.Children[parent] = list = [];
            list.Add(m);
        }
        // الجذر الذي رقمه 1000 فأكثر (عمولات، مواد مجرودة…) خارج إجمالي النظام بكل ما تحته
        foreach (var m in c.BySeq.Values)
        {
            var root = m;
            var guard = 0;
            while (root.Father > 0 && guard++ < 40 && c.BySeq.TryGetValue(root.Father, out var up)) root = up;
            var digits = root.Num.TrimStart('0');
            m.Excluded = root.Num.Length > 0 && root.Num.All(char.IsAsciiDigit) && digits.Length >= 4;
        }
        _catalog = c;
        _catalogAt = DateTime.Now;
        return c;
    }

    private static bool IsUnder(Catalog catalog, Mat m, long ancestor)
    {
        var guard = 0;
        for (var cur = m; cur is not null && guard++ < 40; cur = cur.Father > 0 ? catalog.BySeq.GetValueOrDefault(cur.Father) : null)
            if (cur.Seq == ancestor) return true;
        return false;
    }

    private static List<long> LeavesUnder(Catalog catalog, Mat node, int limit)
    {
        var leaves = new List<long>();
        var stack = new Stack<Mat>();
        stack.Push(node);
        while (stack.Count > 0 && leaves.Count < limit)
        {
            var cur = stack.Pop();
            if (cur.Leaf)
            {
                leaves.Add(cur.Seq);
                continue;
            }
            foreach (var child in catalog.Children.GetValueOrDefault(cur.Seq) ?? []) stack.Push(child);
        }
        return leaves;
    }

    /* ── دليل الحسابات والبائعون ── */
    private sealed record Account(long Seq, string Code, string Name);

    private sealed class AccountBook
    {
        public Dictionary<long, Account> BySeq = [];
        public Dictionary<string, Account> ByCode = [];
    }

    private async Task<AccountBook> LoadAccountsAsync(CancellationToken ct)
    {
        if (_accounts is not null && DateTime.Now - _accountsAt < AccountsTtl) return _accounts;
        var rows = await text.QueryAsync("SELECT Seq, Num, Name1 FROM File11n", ct);
        if (!text.LastCallSucceeded || rows.Count == 0)
            return _accounts ?? throw new InvalidOperationException("تعذر قراءة دليل الحسابات من الإداري");
        var book = new AccountBook();
        foreach (var r in rows)
        {
            var acc = new Account((long)Num(Cell(r, 0)), Digits(Cell(r, 1)), Cell(r, 2)?.Trim() ?? "");
            book.BySeq[acc.Seq] = acc;
            if (acc.Code.Length > 0) book.ByCode.TryAdd(acc.Code, acc);
        }
        _accounts = book;
        _accountsAt = DateTime.Now;
        return book;
    }

    private async Task<Dictionary<string, string>> LoadSellersAsync(CancellationToken ct)
    {
        if (_sellers is not null && DateTime.Now - _sellersAt < CatalogTtl) return _sellers;
        var rows = await text.QueryAsync("SELECT Num, Name FROM FileCrMst WHERE Type = 3", ct);
        var map = new Dictionary<string, string>();
        foreach (var r in rows)
        {
            var num = Cell(r, 0)?.Trim() ?? "";
            var name = Cell(r, 1)?.Trim() ?? "";
            if (num.Length > 0 && name.Length > 0) map[num] = name;
        }
        if (map.Count > 0)
        {
            _sellers = map;
            _sellersAt = DateTime.Now;
        }
        return map;
    }

    /* ── الفروع (مطابق لفلترة تطبيق الحسابات) ── */
    [GeneratedRegex(@"الفرع\s*[:\-]?\s*(\S+)")]
    private static partial Regex BranchToken();

    [GeneratedRegex(@"الفرع\s*[:\-]?\s*(.+)$")]
    private static partial Regex BranchWord();

    /// <summary>رقم الفرع من الملاحظات: null بلا «الفرع»، فارغ إن كانت الكلمة بعدها ليست رقماً («الفرع دلفري»).</summary>
    private static string? RemarksBranchNumber(string remarks)
    {
        var m = BranchToken().Match(remarks);
        if (!m.Success) return null;
        var tok = new string(m.Groups[1].Value.Where(char.IsLetterOrDigit).ToArray());
        return tok.Length > 0 && tok.All(char.IsAsciiDigit) ? tok : "";
    }

    private static string RemarksBranchWord(string remarks)
    {
        var m = BranchWord().Match(remarks);
        if (!m.Success) return "";
        var w = m.Groups[1].Value.Trim();
        return w.Length > 40 ? w[..40] : w;
    }

    private static string ComposeBranchLabel(string code, bool numbered, string name, string? remarkWord)
    {
        name = name.Trim();
        if (numbered) return name.Length > 0 ? $"الفرع {code} — {name}" : $"الفرع {code}";
        var label = name.Length > 0 ? name : code.Length > 0 ? $"حساب {code}" : "(بدون فرع)";
        if (!string.IsNullOrWhiteSpace(remarkWord))
        {
            var w = Normalize(remarkWord);
            if (w.Length > 0 && !Normalize(name).Contains(w)) label = $"{label} · الفرع {remarkWord.Trim()}";
        }
        return label;
    }

    /* ── أدوات ── */
    private async Task<IReadOnlyList<string?[]>> Query(string sql, CancellationToken ct)
    {
        var rows = await text.QueryAsync(sql, ct);
        if (!text.LastCallSucceeded) throw new InvalidOperationException("تعذر الاتصال بالإداري لقراءة المبيعات — تأكد أن خادم الإداري يعمل");
        return rows;
    }

    /// <summary>تطبيع عربي للبحث: توحيد الألف والياء والتاء المربوطة وحذف التشكيل والتطويل.</summary>
    private static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var sb = new StringBuilder(value.Length);
        var space = false;
        foreach (var raw in value.Trim().ToLowerInvariant())
        {
            var ch = raw;
            if (ch is >= 'ً' and <= 'ٟ' or 'ٰ' or 'ـ') continue;
            ch = ch switch
            {
                'أ' or 'إ' or 'آ' or 'ٱ' => 'ا',
                'ى' or 'ئ' => 'ي',
                'ة' => 'ه',
                'ؤ' => 'و',
                >= '٠' and <= '٩' => (char)('0' + (ch - '٠')),
                _ => ch,
            };
            if (char.IsWhiteSpace(ch))
            {
                space = sb.Length > 0;
                continue;
            }
            if (space) sb.Append(' ');
            space = false;
            sb.Append(ch);
        }
        return sb.ToString();
    }

    private static string Digits(string? v) => new((v ?? "").Where(char.IsAsciiDigit).ToArray());

    private static string? Cell(string?[] row, int i) => i < row.Length ? row[i] : null;

    private static decimal Num(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return 0;
        var s = v.Trim().Replace(",", "");
        return decimal.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d
            : double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? (decimal)f : 0;
    }

    private static string Iso(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Ts(DateTime d) => $"TIMESTAMP '{d:yyyy-MM-dd} 00:00:00'";

    [GeneratedRegex(@"^(\d{1,2})/(\d{1,2})/(\d{4})")]
    private static partial Regex SlashDate();

    private static DateTime? ParseDate(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        var m = SlashDate().Match(v.Trim());
        if (m.Success)
        {
            int d = int.Parse(m.Groups[1].Value), mo = int.Parse(m.Groups[2].Value), y = int.Parse(m.Groups[3].Value);
            if (y <= 1900 || mo is < 1 or > 12 || d < 1 || d > DateTime.DaysInMonth(y, mo)) return null;
            return new DateTime(y, mo, d);
        }
        return DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) && dt.Year > 1900 ? dt.Date : null;
    }
}
