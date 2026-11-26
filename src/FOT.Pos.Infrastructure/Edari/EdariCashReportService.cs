using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>صندوق من «إداري» برصيده الحالي وحركة آخر الأيام.</summary>
public sealed record CashBoxDto(
    long Seq,
    string Num,
    string Name,
    // IQD أو USD — مبالغ الصندوق وحركاته بهذه العملة.
    string Currency,
    bool Featured,
    // النقد في الصندوق الآن: الرصيد المثبّت + الحركات بعد تاريخ التثبيت.
    decimal Balance,
    // الرصيد الدفتري (مجموع المدين − الدائن). يختلف عن Balance إن أُدخلت قيود بتاريخ سابق للتثبيت.
    decimal LedgerBalance,
    string? FixDate,
    decimal? FixBalance,
    decimal TodayIn,
    decimal TodayOut,
    int TodayCount,
    IReadOnlyList<CashDayDto> Days);

public sealed record CashDayDto(string Date, decimal In, decimal Out, int Count, decimal Closing);

public sealed record CashBoxesDto(string Today, DateTime At, IReadOnlyList<CashBoxDto> Boxes, IReadOnlyList<string> Featured, string RootNum);

public sealed record CashLineDto(
    long Seq,
    string Num,
    string Date,
    string? Time,
    string Description,
    decimal In,
    decimal Out,
    decimal Balance,
    // الحساب المقابل (من دُفع له أو قُبض منه).
    string? Other,
    string? BillNum,
    // سعر الصرف المسجّل على القيد (لصندوق الدولار).
    decimal? Rate);

public sealed record CashStatementDto(
    CashBoxDto Box,
    string From,
    string To,
    decimal Opening,
    decimal Closing,
    decimal TotalIn,
    decimal TotalOut,
    int Count,
    bool Truncated,
    IReadOnlyList<CashLineDto> Lines,
    IReadOnlyList<CashDayDto> Days);

public sealed class CashReportSettings
{
    /// <summary>رقم حساب «صناديق المحل» في دليل الحسابات — كل حساباته الفرعية صناديق.</summary>
    public string RootNum { get; set; } = "100";

    /// <summary>أرقام الصناديق البارزة (تظهر أولاً في التطبيق): الدولار، الخشن، الناعم، بطاقة كي.</summary>
    public List<string> Featured { get; set; } = ["131", "132", "133", "301"];
}

/// <summary>
/// تقرير الصناديق من «إداري» مباشرة (قراءة فقط): الأرصدة الحالية وكشف الحركات لفترة.
///
/// الرصيد يُحسب كما في كشف صندوق الإداري: الصناديق الرئيسية تُثبَّت يدوياً (FixDate/FixBal = النقد
/// المعدود في نهاية ذلك اليوم)، فالرصيد الآن = المثبّت + القيود بعد تاريخ التثبيت. حقلا Bal و Tot
/// لا يكفيان وحدهما: Bal هو الرصيد المدوّر من السنة السابقة، و Tot يشمل قيوداً أُدخلت بتاريخ سابق للتثبيت.
/// المدين (Dept) = قبض يدخل الصندوق، والدائن = صرف يخرج منه. صندوق الدولار مبالغه بالدولار.
/// </summary>
public sealed partial class EdariCashReportService(EdariTextQueryService text)
{
    private const int MaxLines = 6000;
    private const int HistoryDays = 14;
    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FOT.Pos", "cash-report.json");
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private static readonly SemaphoreSlim CacheGate = new(1, 1);
    private static CashBoxesDto? _boxes;
    private static DateTime _boxesAt;
    private static Dictionary<long, string>? _names;
    private static DateTime _namesAt;

    /* ── الإعدادات ── */
    public static CashReportSettings LoadSettings()
    {
        try
        {
            if (File.Exists(SettingsPath))
            {
                var s = JsonSerializer.Deserialize<CashReportSettings>(File.ReadAllText(SettingsPath), Json);
                if (s is not null)
                {
                    s.RootNum = CleanNum(s.RootNum) is { Length: > 0 } r ? r : "100";
                    s.Featured = (s.Featured ?? []).Select(CleanNum).Where(n => n.Length > 0).Distinct().Take(12).ToList();
                    return s;
                }
            }
        }
        catch
        {
            /* ملف تالف: الافتراضي */
        }
        return new CashReportSettings();
    }

    public static CashReportSettings SaveSettings(CashReportSettings input)
    {
        var s = new CashReportSettings
        {
            RootNum = CleanNum(input.RootNum) is { Length: > 0 } r ? r : "100",
            Featured = (input.Featured ?? []).Select(CleanNum).Where(n => n.Length > 0).Distinct().Take(12).ToList(),
        };
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(s, Json));
        _boxes = null;
        return s;
    }

    private static string CleanNum(string? v) => new((v ?? "").Where(char.IsAsciiDigit).Take(20).ToArray());

    /* ── الصناديق وأرصدتها ── */
    /// <summary>كل الصناديق بأرصدتها الآن. النتيجة تُحفظ لثوانٍ كي لا يتكرر الاستعلام مع كل طلب.</summary>
    public async Task<CashBoxesDto> GetBoxesAsync(bool fresh, CancellationToken ct)
    {
        if (!fresh && _boxes is not null && DateTime.Now - _boxesAt < TimeSpan.FromSeconds(20)) return _boxes;
        await CacheGate.WaitAsync(ct);
        try
        {
            if (!fresh && _boxes is not null && DateTime.Now - _boxesAt < TimeSpan.FromSeconds(20)) return _boxes;
            var built = await BuildBoxesAsync(ct);
            _boxes = built;
            _boxesAt = DateTime.Now;
            return built;
        }
        finally
        {
            CacheGate.Release();
        }
    }

    private async Task<CashBoxesDto> BuildBoxesAsync(CancellationToken ct)
    {
        var settings = LoadSettings();
        var today = DateTime.Today;
        var accounts = await LoadAccountsAsync(settings, ct);
        if (accounts.Count == 0)
            throw new InvalidOperationException("تعذر قراءة الصناديق من الإداري — تأكد أن خادم الإداري يعمل وأن رقم حساب الصناديق صحيح");

        // حركة كل يوم لكل صندوق منذ أقدم تاريخ تثبيت (أو آخر أسبوعين) — استعلام واحد مجمَّع
        var since = today.AddDays(-HistoryDays);
        foreach (var a in accounts)
            if (a.FixDate is { } fd && a.CashFix != 0 && fd < since) since = fd;
        var daily = await LoadDailyAsync(accounts.Select(a => a.Seq), since, ct);

        var boxes = new List<CashBoxDto>();
        foreach (var a in accounts)
        {
            var days = daily.GetValueOrDefault(a.Seq) ?? [];
            decimal balance;
            if (a.FixDate is { } fix && a.CashFix != 0)
                balance = a.CashFix + days.Where(d => d.Date > fix).Sum(d => d.In - d.Out);
            else
                balance = a.Ledger;

            // آخر أسبوعين برصيد نهاية كل يوم (رجوعاً من الرصيد الحالي)
            var recent = new List<CashDayDto>();
            var running = balance;
            for (var d = today; d > today.AddDays(-HistoryDays); d = d.AddDays(-1))
            {
                var row = days.FirstOrDefault(x => x.Date == d);
                recent.Add(new CashDayDto(Iso(d), row?.In ?? 0, row?.Out ?? 0, row?.Count ?? 0, running));
                running -= (row?.In ?? 0) - (row?.Out ?? 0);
            }
            var t = days.FirstOrDefault(x => x.Date == today);
            boxes.Add(new CashBoxDto(
                a.Seq, a.Num, a.Name, a.Currency, settings.Featured.Contains(a.Num),
                Round(balance, a.Currency), Round(a.Ledger, a.Currency),
                a.FixDate is { } f && a.CashFix != 0 ? Iso(f) : null,
                a.FixDate is not null && a.CashFix != 0 ? Round(a.CashFix, a.Currency) : null,
                t?.In ?? 0, t?.Out ?? 0, t?.Count ?? 0, recent));
        }

        // البارزة أولاً بترتيب الإعدادات، ثم البقية برقم الحساب
        var ordered = boxes
            .OrderBy(b => b.Featured ? settings.Featured.IndexOf(b.Num) : int.MaxValue)
            .ThenBy(b => b.Num.Length).ThenBy(b => b.Num, StringComparer.Ordinal)
            .ToList();
        return new CashBoxesDto(Iso(today), DateTime.Now, ordered, settings.Featured, settings.RootNum);
    }

    /* ── كشف صندوق لفترة ── */
    public async Task<CashStatementDto> GetStatementAsync(long seq, DateTime from, DateTime to, CancellationToken ct)
    {
        from = from.Date;
        to = to.Date;
        if (to < from) (from, to) = (to, from);
        if ((to - from).TotalDays > 366) from = to.AddDays(-366);

        var all = await GetBoxesAsync(false, ct);
        var box = all.Boxes.FirstOrDefault(b => b.Seq == seq) ?? throw new KeyNotFoundException("الصندوق غير موجود");
        var settings = LoadSettings();
        var acc = (await LoadAccountsAsync(settings, ct)).First(a => a.Seq == seq);
        var names = await LoadNamesAsync(ct);

        // رصيد أول الفترة
        decimal opening;
        if (acc.FixDate is { } fix && acc.CashFix != 0)
        {
            // من نقطة التثبيت (نهاية يوم التثبيت) تقدّماً أو رجوعاً حتى بداية الفترة
            opening = from > fix
                ? acc.CashFix + await NetAsync(seq, fix.AddDays(1), from, ct)
                : acc.CashFix - await NetAsync(seq, from, fix.AddDays(1), ct);
        }
        else if (acc.FixDate is not null)
        {
            // صناديق الكاشير: تُصفَّر يومياً وكشفها مستقل لكل فترة
            opening = 0;
        }
        else
        {
            // بلا تثبيت: الرصيد المدوّر + كل ما قبل الفترة = الدفتري − ما جرى منذ بداية الفترة
            opening = acc.Ledger - await NetAsync(seq, from, DateTime.Today.AddDays(2), ct);
        }

        var rows = await text.QueryAsync($"""
            SELECT TOP {MaxLines + 1} Seq, Num, "Date", Am, Dept, Exp1, Exp2, Remarks, Two, Equal, DtCreated, BillNum
            FROM File12n
            WHERE Acc = {seq} AND "Date" >= {Ts(from)} AND "Date" < {Ts(to.AddDays(1))}
            ORDER BY "Date", Seq
            """, ct);
        if (!text.LastCallSucceeded) throw new InvalidOperationException("تعذر الاتصال بالإداري لقراءة حركات الصندوق");

        var truncated = rows.Count > MaxLines;
        var lines = new List<CashLineDto>();
        var running = opening;
        decimal totalIn = 0, totalOut = 0;
        foreach (var r in rows.Take(MaxLines))
        {
            var date = ParseDate(Cell(r, 2));
            if (date is null) continue;
            var am = Math.Abs(Num(Cell(r, 3)));
            // مبالغ القيود بالدينار تُعرض أعداداً صحيحة كما في الإداري
            if (acc.Currency == "IQD") am = Math.Round(am);
            var debit = IsTrue(Cell(r, 4));
            var cashIn = debit ? am : 0;
            var cashOut = debit ? 0 : am;
            running += cashIn - cashOut;
            totalIn += cashIn;
            totalOut += cashOut;
            var two = (long)Num(Cell(r, 8));
            var bill = Cell(r, 11)?.Trim();
            var rate = Num(Cell(r, 9));
            lines.Add(new CashLineDto(
                (long)Num(Cell(r, 0)),
                Cell(r, 1)?.Trim() ?? "",
                Iso(date.Value),
                ParseTime(Cell(r, 10)),
                Describe(Cell(r, 5), Cell(r, 6), Cell(r, 7)),
                cashIn, cashOut, Round(running, acc.Currency),
                two > 0 && names.TryGetValue(two, out var other) ? other : null,
                string.IsNullOrEmpty(bill) || bill == "0" ? null : bill,
                acc.Currency == "USD" && rate > 1 ? rate : null));
        }

        var days = new List<CashDayDto>();
        foreach (var g in lines.GroupBy(l => l.Date))
            days.Add(new CashDayDto(g.Key, g.Sum(l => l.In), g.Sum(l => l.Out), g.Count(), g.Last().Balance));

        return new CashStatementDto(box, Iso(from), Iso(to), Round(opening, acc.Currency), Round(running, acc.Currency),
            totalIn, totalOut, lines.Count, truncated, lines, days);
    }

    /* ── القراءة من الإداري ── */
    private sealed class Account
    {
        public long Seq;
        public string Num = "";
        public string Name = "";
        public string Currency = "IQD";
        /// <summary>النقد المثبّت (موجب = نقد في الصندوق)، 0 إن لم يُثبَّت.</summary>
        public decimal CashFix;
        public DateTime? FixDate;
        /// <summary>الرصيد الدفتري نقداً: المدين − الدائن.</summary>
        public decimal Ledger;
    }

    private sealed record DayRow(DateTime Date, decimal In, decimal Out, int Count);

    private async Task<List<Account>> LoadAccountsAsync(CashReportSettings settings, CancellationToken ct)
    {
        const string cols = "Seq, Num, Name1, Bal, Tot1, Tot2, CBal, CTot1, CTot2, Acur, FixDate, FixBal, CloseAcc, SubCount";
        var root = await text.QueryAsync($"SELECT Seq FROM File11n WHERE Num = '{settings.RootNum}'", ct);
        var rootSeq = root.Count > 0 ? (long)Num(Cell(root[0], 0)) : 0;
        var featured = settings.Featured.Count > 0 ? string.Join(",", settings.Featured.Select(n => $"'{n}'")) : "''";
        var where = rootSeq > 0 ? $"Master = {rootSeq} OR Num IN ({featured})" : $"Num IN ({featured})";
        var rows = await text.QueryAsync($"SELECT {cols} FROM File11n WHERE {where}", ct);

        var list = new List<Account>();
        foreach (var r in rows)
        {
            // حساب مغلق أو حساب أب (مجموعة) ليس صندوقاً
            if (Num(Cell(r, 12)) != 0 || Num(Cell(r, 13)) > 0) continue;
            var usd = Num(Cell(r, 9)) == 1;
            var bal = Num(Cell(r, 3));
            var tot1 = usd ? Num(Cell(r, 7)) : Num(Cell(r, 4));
            var tot2 = usd ? Num(Cell(r, 8)) : Num(Cell(r, 5));
            var fixBal = Num(Cell(r, 11));
            // FixBal قد يُخزَّن بإشارة معاكسة للرصيد: يُعتمد اتجاه الرصيد عند التعارض (كما في كشف الإداري)
            if (fixBal != 0 && bal != 0 && Math.Sign(fixBal) != Math.Sign(bal)) fixBal = -fixBal;
            list.Add(new Account
            {
                Seq = (long)Num(Cell(r, 0)),
                Num = Cell(r, 1)?.Trim() ?? "",
                Name = Cell(r, 2)?.Trim() ?? "",
                Currency = usd ? "USD" : "IQD",
                FixDate = ParseDate(Cell(r, 10)),
                // الرصيد في الإداري سالب للمدين (نقد في الصندوق) — نعرضه موجباً
                CashFix = -fixBal,
                Ledger = tot1 - tot2,
            });
        }
        return list.GroupBy(a => a.Seq).Select(g => g.First()).ToList();
    }

    /// <summary>مجموع القبض والصرف لكل يوم ولكل صندوق منذ تاريخ.</summary>
    private async Task<Dictionary<long, List<DayRow>>> LoadDailyAsync(IEnumerable<long> seqs, DateTime since, CancellationToken ct)
    {
        var ids = string.Join(",", seqs.Distinct());
        var map = new Dictionary<long, List<DayRow>>();
        if (ids.Length == 0) return map;
        var rows = await text.QueryAsync($"""
            SELECT Acc, "Date", Dept, SUM(Am) AS S, COUNT(*) AS N
            FROM File12n
            WHERE Acc IN ({ids}) AND "Date" >= {Ts(since)}
            GROUP BY Acc, "Date", Dept
            """, ct);
        if (!text.LastCallSucceeded) throw new InvalidOperationException("تعذر الاتصال بالإداري لقراءة حركات الصناديق");
        var acc = new Dictionary<(long, DateTime), (decimal In, decimal Out, int N)>();
        foreach (var r in rows)
        {
            var date = ParseDate(Cell(r, 1));
            if (date is null) continue;
            var key = ((long)Num(Cell(r, 0)), date.Value);
            var cur = acc.GetValueOrDefault(key);
            var sum = Math.Abs(Num(Cell(r, 3)));
            var n = (int)Num(Cell(r, 4));
            acc[key] = IsTrue(Cell(r, 2)) ? (cur.In + sum, cur.Out, cur.N + n) : (cur.In, cur.Out + sum, cur.N + n);
        }
        foreach (var (key, v) in acc)
        {
            if (!map.TryGetValue(key.Item1, out var list)) map[key.Item1] = list = [];
            list.Add(new DayRow(key.Item2, v.In, v.Out, v.N));
        }
        return map;
    }

    /// <summary>صافي النقد (قبض − صرف) للقيود من بداية يوم from إلى ما قبل يوم to.</summary>
    private async Task<decimal> NetAsync(long seq, DateTime from, DateTime toExclusive, CancellationToken ct)
    {
        if (toExclusive <= from) return 0;
        var rows = await text.QueryAsync($"""
            SELECT Dept, SUM(Am) AS S FROM File12n
            WHERE Acc = {seq} AND "Date" >= {Ts(from)} AND "Date" < {Ts(toExclusive)}
            GROUP BY Dept
            """, ct);
        if (!text.LastCallSucceeded) throw new InvalidOperationException("تعذر الاتصال بالإداري لحساب رصيد الصندوق");
        decimal net = 0;
        foreach (var r in rows) net += IsTrue(Cell(r, 0)) ? Math.Abs(Num(Cell(r, 1))) : -Math.Abs(Num(Cell(r, 1)));
        return net;
    }

    /// <summary>أسماء الحسابات (للحساب المقابل في كل قيد) — نحو ألف حساب، تُحفظ خمس دقائق.</summary>
    private async Task<Dictionary<long, string>> LoadNamesAsync(CancellationToken ct)
    {
        if (_names is not null && DateTime.Now - _namesAt < TimeSpan.FromMinutes(5)) return _names;
        var rows = await text.QueryAsync("SELECT Seq, Name1 FROM File11n", ct);
        var map = new Dictionary<long, string>();
        foreach (var r in rows)
        {
            var name = Cell(r, 1)?.Trim();
            if (!string.IsNullOrEmpty(name)) map[(long)Num(Cell(r, 0))] = name;
        }
        if (map.Count > 0)
        {
            _names = map;
            _namesAt = DateTime.Now;
        }
        return map;
    }

    /* ── أدوات ── */
    private static string? Cell(string?[] row, int i) => i < row.Length ? row[i] : null;

    private static decimal Num(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return 0;
        var s = v.Trim().Replace(",", "");
        return decimal.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d
            : double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? (decimal)f : 0;
    }

    private static bool IsTrue(string? v) => v is not null && (v.Equals("True", StringComparison.OrdinalIgnoreCase) || v == "1");

    private static decimal Round(decimal v, string currency) => Math.Round(v, currency == "USD" ? 2 : 0);

    private static string Iso(DateTime d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Ts(DateTime d) => $"TIMESTAMP '{d:yyyy-MM-dd} 00:00:00'";

    [GeneratedRegex(@"^(\d{1,2})/(\d{1,2})/(\d{4})")]
    private static partial Regex SlashDate();

    [GeneratedRegex(@"(\d{1,2}):(\d{2})(?::\d{2})?\s*([صم]|AM|PM)?", RegexOptions.IgnoreCase)]
    private static partial Regex ClockTime();

    /// <summary>تاريخ الإداري «يوم/شهر/سنة»؛ 30/12/1899 يعني «بلا تاريخ».</summary>
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

    /// <summary>وقت الإدخال من «25/11/2026 10:33:22 م» ← «22:33».</summary>
    private static string? ParseTime(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        var space = v.IndexOf(' ');
        if (space < 0) return null;
        var m = ClockTime().Match(v[space..]);
        if (!m.Success) return null;
        var h = int.Parse(m.Groups[1].Value);
        var mark = m.Groups[3].Value;
        if ((mark == "م" || mark.Equals("PM", StringComparison.OrdinalIgnoreCase)) && h < 12) h += 12;
        if ((mark == "ص" || mark.Equals("AM", StringComparison.OrdinalIgnoreCase)) && h == 12) h = 0;
        return $"{h:00}:{m.Groups[2].Value}";
    }

    private static string Describe(params string?[] parts)
    {
        var seen = new List<string>();
        foreach (var p in parts)
        {
            var t = p?.Trim();
            if (!string.IsNullOrEmpty(t) && !seen.Contains(t)) seen.Add(t);
        }
        return string.Join(" — ", seen);
    }
}
