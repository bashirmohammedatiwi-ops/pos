using System.Security.Cryptography;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class DiscountQrRepository(ISqlConnectionFactory db)
{
    /// <summary>أعمدة الرمز وشروطه واستخدامه. الاستخدام يُعدّ من usage_since، وتُعدّ فواتير البيع فقط.</summary>
    private const string PersonSelect = """
        SELECT p.id AS Id, p.name AS Name, p.code AS Code,
               CAST(p.active AS bit) AS Active, p.created_at AS CreatedAt,
               COALESCE(life.ReceiptCount, 0) AS ReceiptCount,
               CAST(COALESCE(life.TotalDiscount, 0) AS DECIMAL(18,2)) AS TotalDiscount,
               p.max_percent AS MaxPercent, p.max_amount AS MaxAmount, p.min_invoice AS MinInvoice,
               p.weekdays AS Weekdays, p.time_from AS TimeFrom, p.time_to AS TimeTo,
               CONVERT(CHAR(10), p.valid_from, 23) AS ValidFrom, CONVERT(CHAR(10), p.valid_to, 23) AS ValidTo,
               p.max_uses AS MaxUses, p.max_uses_per_day AS MaxUsesPerDay,
               p.budget_total AS BudgetTotal, p.budget_month AS BudgetMonth,
               CAST(p.allow_gift AS bit) AS AllowGift, p.note AS Note, p.usage_since AS UsageSince,
               COALESCE(u.UsesToday, 0) AS UsesToday, COALESCE(u.UsesSince, 0) AS UsesSince,
               CAST(COALESCE(u.SpentMonth, 0) AS DECIMAL(18,2)) AS SpentMonth,
               CAST(COALESCE(u.SpentSince, 0) AS DECIMAL(18,2)) AS SpentSince,
               GETDATE() AS UsageAt,
               COALESCE(life.ViolationCount, 0) AS ViolationCount
        FROM ext_discount_qr_people p
        OUTER APPLY (
            SELECT COUNT(*) AS ReceiptCount, SUM(r.user_discount) AS TotalDiscount,
                   SUM(CASE WHEN r.discount_qr_violation IS NOT NULL THEN 1 ELSE 0 END) AS ViolationCount
            FROM reciepts r WITH (NOLOCK)
            WHERE r.discount_qr_person_id = p.id AND r.user_discount > 0
        ) life
        OUTER APPLY (
            SELECT SUM(CASE WHEN r.creation_date >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS UsesToday,
                   COUNT(*) AS UsesSince,
                   SUM(CASE WHEN r.creation_date >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) THEN r.user_discount ELSE 0 END) AS SpentMonth,
                   SUM(r.user_discount) AS SpentSince
            FROM reciepts r WITH (NOLOCK)
            WHERE r.discount_qr_person_id = p.id AND r.user_discount > 0 AND r.kind = 0 AND r.is_pending = 0
              AND r.creation_date >= COALESCE(p.usage_since, '19000101')
        ) u
        """;

    public async Task<IReadOnlyList<DiscountQrPersonDto>> ListAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<DiscountQrPersonDto>(new CommandDefinition(
            PersonSelect + " ORDER BY p.active DESC, p.name", cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<DiscountQrPersonDto>> ListActiveAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<DiscountQrPersonDto>(new CommandDefinition(
            PersonSelect + " WHERE p.active = 1 ORDER BY p.name", cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<DiscountQrPersonDto?> FindByCodeAsync(string code, CancellationToken ct)
    {
        var normalized = Normalize(code);
        if (normalized is null) return null;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<DiscountQrPersonDto>(new CommandDefinition(
            PersonSelect + " WHERE p.code = @code AND p.active = 1", new { code = normalized }, cancellationToken: ct));
    }

    public async Task<DiscountQrPersonDto?> GetByIdAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<DiscountQrPersonDto>(new CommandDefinition(
            PersonSelect + " WHERE p.id = @id", new { id }, cancellationToken: ct));
    }

    public async Task<DiscountQrPersonDto> CreateAsync(string name, DiscountQrRulesRequest? rules, CancellationToken ct)
    {
        var trimmed = (name ?? "").Trim();
        if (trimmed.Length == 0)
            throw new InvalidOperationException("أدخل اسم الشخص");
        if (rules is not null) Validate(rules);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        for (var i = 0; i < 6; i++)
        {
            var code = NewCode();
            try
            {
                var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                    INSERT INTO ext_discount_qr_people (name, code, active)
                    OUTPUT INSERTED.id
                    VALUES (@name, @code, 1)
                    """, new { name = trimmed, code }, cancellationToken: ct));
                if (rules is not null) await UpdateRulesAsync(id, rules, ct);
                return (await GetByIdAsync(id, ct))!;
            }
            catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
            {
                /* unique code collision — retry */
            }
        }

        throw new InvalidOperationException("تعذر توليد رمز فريد");
    }

    public async Task UpdateAsync(long id, string? name, bool? active, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_discount_qr_people
            SET name = COALESCE(NULLIF(LTRIM(RTRIM(@name)), N''), name),
                active = COALESCE(@active, active)
            WHERE id = @id
            """, new { id, name, active }, cancellationToken: ct));
        if (rows == 0) throw new InvalidOperationException("الشخص غير موجود");
    }

    /// <summary>
    /// يحفظ الشروط. أول مرة يُوضع فيها حد استخدام يبدأ العدّ من الآن،
    /// حتى لا يقف رمز قديم فوراً بسبب فواتيره السابقة.
    /// </summary>
    public async Task UpdateRulesAsync(long id, DiscountQrRulesRequest r, CancellationToken ct)
    {
        Validate(r);
        var hasTime = r.TimeFrom is not null && r.TimeTo is not null;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_discount_qr_people
            SET max_percent = @MaxPercent, max_amount = @MaxAmount, min_invoice = @MinInvoice,
                weekdays = @weekdays, time_from = @timeFrom, time_to = @timeTo,
                valid_from = @validFrom, valid_to = @validTo,
                max_uses = @MaxUses, max_uses_per_day = @MaxUsesPerDay,
                budget_total = @BudgetTotal, budget_month = @BudgetMonth,
                allow_gift = @AllowGift, note = @note,
                usage_since = CASE
                    WHEN usage_since IS NULL AND (@MaxUses IS NOT NULL OR @MaxUsesPerDay IS NOT NULL OR @BudgetTotal IS NOT NULL OR @BudgetMonth IS NOT NULL)
                    THEN GETDATE() ELSE usage_since END
            WHERE id = @id
            """, new
        {
            id,
            r.MaxPercent,
            r.MaxAmount,
            r.MinInvoice,
            weekdays = r.Weekdays == 127 ? null : r.Weekdays,
            timeFrom = hasTime ? r.TimeFrom : null,
            timeTo = hasTime ? r.TimeTo : null,
            validFrom = ParseDay(r.ValidFrom),
            validTo = ParseDay(r.ValidTo),
            r.MaxUses,
            r.MaxUsesPerDay,
            r.BudgetTotal,
            r.BudgetMonth,
            r.AllowGift,
            note = string.IsNullOrWhiteSpace(r.Note) ? null : r.Note.Trim(),
        }, cancellationToken: ct));
        if (rows == 0) throw new InvalidOperationException("الشخص غير موجود");
    }

    /// <summary>تصفير عدّاد الاستخدام: تبدأ حدود الرمز من جديد، وتبقى الفواتير السابقة في التقارير.</summary>
    public async Task ResetUsageAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_discount_qr_people SET usage_since = GETDATE() WHERE id = @id", new { id }, cancellationToken: ct));
    }

    private static void Validate(DiscountQrRulesRequest r)
    {
        if (r.MaxPercent is <= 0 or > 100) throw new InvalidOperationException("نسبة الخصم بين 0 و 100");
        if (r.MaxAmount is <= 0) throw new InvalidOperationException("أقصى مبلغ خصم يجب أن يكون أكبر من صفر");
        if (r.MinInvoice is < 0) throw new InvalidOperationException("أقل فاتورة لا يكون سالباً");
        if (r.Weekdays is <= 0 or > 127) throw new InvalidOperationException("اختر يوماً واحداً على الأقل");
        if ((r.TimeFrom is null) != (r.TimeTo is null)) throw new InvalidOperationException("حدد وقت البداية والنهاية معاً");
        if (r.TimeFrom is < 0 or >= 1440 || r.TimeTo is < 0 or >= 1440) throw new InvalidOperationException("الوقت غير صحيح");
        if (r.TimeFrom is not null && r.TimeFrom == r.TimeTo) throw new InvalidOperationException("وقت البداية والنهاية متطابقان");
        var from = ParseDay(r.ValidFrom);
        var to = ParseDay(r.ValidTo);
        if (from is not null && to is not null && from > to) throw new InvalidOperationException("تاريخ البداية بعد تاريخ النهاية");
        if (r.MaxUses is <= 0 || r.MaxUsesPerDay is <= 0) throw new InvalidOperationException("عدد الفواتير يجب أن يكون أكبر من صفر");
        if (r.BudgetTotal is <= 0 || r.BudgetMonth is <= 0) throw new InvalidOperationException("الميزانية يجب أن تكون أكبر من صفر");
        if ((r.Note?.Trim().Length ?? 0) > 300) throw new InvalidOperationException("الملاحظة طويلة");
    }

    private static DateTime? ParseDay(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateTime.TryParseExact(value.Trim()[..Math.Min(10, value.Trim().Length)], "yyyy-MM-dd",
                System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var day))
            return day;
        throw new InvalidOperationException("التاريخ غير صحيح");
    }

    /// <summary>هل يعمل الرمز في هذا الوقت؟ null = نعم، وإلا سبب المنع. نفس منطق شاشة الكاشير (evaluateDiscountQr).</summary>
    public static string? Evaluate(DiscountQrPersonDto p, DateTime at)
    {
        var day = at.ToString("yyyy-MM-dd");
        if (!string.IsNullOrEmpty(p.ValidFrom) && string.CompareOrdinal(day, p.ValidFrom) < 0) return $"قبل بداية الصلاحية {p.ValidFrom}";
        if (!string.IsNullOrEmpty(p.ValidTo) && string.CompareOrdinal(day, p.ValidTo) > 0) return $"بعد انتهاء الصلاحية {p.ValidTo}";
        var minute = at.Hour * 60 + at.Minute;
        var weekday = (int)at.DayOfWeek;
        if (p.TimeFrom is int from && p.TimeTo is int to && from != to)
        {
            var crosses = from > to;
            var inside = crosses ? minute >= from || minute < to : minute >= from && minute < to;
            if (!inside) return "خارج ساعات الرمز";
            if (crosses && minute < to) weekday = (weekday + 6) % 7;
        }
        if (p.Weekdays is int mask && mask != 127 && (mask & (1 << weekday)) == 0) return "في يوم غير مسموح";
        if (p.MaxUsesPerDay is int perDay && p.UsesToday >= perDay) return $"تجاوز حد اليوم ({perDay} فاتورة)";
        if (p.MaxUses is int uses && p.UsesSince >= uses) return $"تجاوز حد الاستخدام ({uses} فاتورة)";
        if (p.BudgetMonth is decimal month && p.SpentMonth >= month) return "تجاوز ميزانية الشهر";
        if (p.BudgetTotal is decimal total && p.SpentSince >= total) return "تجاوز الميزانية";
        return null;
    }

    /// <summary>أكبر خصم يسمح به الرمز على فاتورة بهذا المجموع. null = بلا حد.</summary>
    public static decimal? Cap(DiscountQrPersonDto p, decimal subtotal)
    {
        if (p.MinInvoice is decimal min && subtotal < min) return 0;
        decimal? cap = null;
        void Lower(decimal v) => cap = cap is null ? v : Math.Min(cap.Value, v);
        if (p.MaxPercent is decimal pct) Lower(Math.Floor(subtotal * pct / 100m));
        if (p.MaxAmount is decimal amount) Lower(amount);
        if (p.BudgetMonth is decimal month) Lower(Math.Max(0, month - p.SpentMonth));
        if (p.BudgetTotal is decimal total) Lower(Math.Max(0, total - p.SpentSince));
        return cap;
    }

    /// <summary>
    /// مراجعة فاتورة وصلت للسيرفر مقابل شروط رمزها. لا تمنع الحفظ أبداً: تعيد سبب المخالفة ليظهر للإدارة.
    /// التقريب عند الكاشير قد يزيد الخصم قليلاً فوق الحد، فلا يُعدّ مخالفة.
    /// </summary>
    public async Task<string?> AuditAsync(long personId, DateTime soldAt, decimal subtotal, decimal userDiscount, CancellationToken ct)
    {
        const decimal roundingTolerance = 250m;
        try
        {
            var person = await GetByIdAsync(personId, ct);
            if (person is null) return null;
            var reason = Evaluate(person, soldAt);
            if (reason is null && Cap(person, subtotal) is decimal cap && userDiscount > cap + roundingTolerance)
                reason = $"خصم {userDiscount:0} فوق الحد {cap:0}";
            return reason;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<DiscountQrReceiptDto>> ListReceiptsAsync(long personId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<DiscountQrReceiptDto>(new CommandDefinition("""
            SELECT r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   CAST(r.user_discount AS DECIMAL(18,2)) AS UserDiscount,
                   c.username AS CashierName,
                   COALESCE(r.discount_qr_person_name, p.name) AS PersonName,
                   r.discount_qr_violation AS Violation
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN ext_discount_qr_people p ON p.id = r.discount_qr_person_id
            WHERE r.discount_qr_person_id = @personId AND r.user_discount > 0
            ORDER BY r.id DESC
            """, new { personId }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<(long Id, string Name)?> ResolveForReceiptAsync(long? personId, string? code, CancellationToken ct)
    {
        if (personId is > 0)
        {
            var byId = await GetByIdAsync(personId.Value, ct);
            if (byId is { Active: true }) return (byId.Id, byId.Name);
        }

        if (!string.IsNullOrWhiteSpace(code))
        {
            var byCode = await FindByCodeAsync(code, ct);
            if (byCode is not null) return (byCode.Id, byCode.Name);
        }

        return null;
    }

    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var code = new string(raw.Trim().ToUpperInvariant().Where(ch => char.IsLetterOrDigit(ch)).ToArray());
        return code.Length == 21 && code.StartsWith("FOTDQ", StringComparison.Ordinal) ? code : null;
    }

    private static string NewCode() => "FOTDQ" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8));
}
