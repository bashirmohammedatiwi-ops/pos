using System.Security.Cryptography;
using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

/// <summary>
/// موظفو تطبيق الفريق: جدول موحّد للبائعين والكاشيرية والمشرفين وغيرهم.
/// البائع يُربط بـ salesman_id فتبقى عمولته وأهدافه وبراندته وأوقات فتحه كما هي.
/// </summary>
public sealed class StaffRepository(ISqlConnectionFactory db)
{
    private const string SelectSql = """
        SELECT s.id AS Id, s.code AS Code, s.name AS Name, s.kind AS Kind, s.job_title AS JobTitle,
               s.phone AS Phone, s.photo_url AS PhotoUrl, s.salesman_id AS SalesmanId, s.cashier_id AS CashierId,
               s.section_id AS SectionId, sec.name AS SectionName,
               s.pin_display AS PinDisplay, CAST(CASE WHEN s.pin_hash IS NULL THEN 0 ELSE 1 END AS bit) AS HasPin,
               s.is_active AS IsActive, s.hire_date AS HireDate, s.notes AS Notes,
               s.device_id AS DeviceId, s.device_label AS DeviceLabel, s.device_bound_at AS DeviceBoundAt,
               a.last_login_at AS LastLoginAt, s.created_at AS CreatedAt
        FROM ext_staff s
        LEFT JOIN sections sec ON sec.id = s.section_id
        LEFT JOIN ext_seller_accounts a ON a.salesman_id = s.salesman_id
        """;

    public async Task<IReadOnlyList<StaffDto>> ListAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<StaffDto>(new CommandDefinition(SelectSql + " ORDER BY s.is_active DESC, s.name", cancellationToken: ct))).ToList();
    }

    public async Task<StaffDto?> GetAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<StaffDto>(new CommandDefinition(SelectSql + " WHERE s.id = @id", new { id }, cancellationToken: ct));
    }

    public async Task<(StaffDto? Row, string? Error)> SaveAsync(long? id, StaffSaveRequest req, CancellationToken ct)
    {
        var code = (req.Code ?? "").Trim();
        var name = (req.Name ?? "").Trim();
        if (code.Length is < 1 or > 20) return (null, "كود الدخول مطلوب (حتى 20 حرفاً)");
        if (name.Length == 0) return (null, "اسم الموظف مطلوب");
        var kind = req.Kind is "seller" or "cashier" or "supervisor" or "other" ? req.Kind : "other";

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var dup = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM ext_staff WHERE code = @code AND (@id IS NULL OR id <> @id)", new { code, id }, cancellationToken: ct));
        if (dup > 0) return (null, "هذا الكود مستخدم لموظف آخر");
        if (req.SalesmanId is > 0)
        {
            var taken = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM ext_staff WHERE salesman_id = @sid AND (@id IS NULL OR id <> @id)", new { sid = req.SalesmanId, id }, cancellationToken: ct));
            if (taken > 0) return (null, "هذا البائع مربوط بموظف آخر");
        }
        if (req.CashierId is > 0)
        {
            var taken = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM ext_staff WHERE cashier_id = @cid AND (@id IS NULL OR id <> @id)", new { cid = req.CashierId, id }, cancellationToken: ct));
            if (taken > 0) return (null, "هذا الكاشير مربوط بموظف آخر");
        }

        var p = new
        {
            id,
            code,
            name,
            kind,
            jobTitle = Clean(req.JobTitle, 120),
            phone = Clean(req.Phone, 40),
            salesmanId = req.SalesmanId is > 0 ? req.SalesmanId : null,
            cashierId = req.CashierId is > 0 ? req.CashierId : null,
            sectionId = req.SectionId is > 0 ? req.SectionId : null,
            hireDate = req.HireDate?.Date,
            notes = Clean(req.Notes, 1000),
            isActive = req.IsActive ?? true,
        };
        if (id is null)
        {
            id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO ext_staff (code, name, kind, job_title, phone, salesman_id, cashier_id, section_id, hire_date, notes, is_active)
                OUTPUT INSERTED.id
                VALUES (@code, @name, @kind, @jobTitle, @phone, @salesmanId, @cashierId, @sectionId, @hireDate, @notes, @isActive)
                """, p, cancellationToken: ct));
        }
        else
        {
            var n = await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE ext_staff SET code = @code, name = @name, kind = @kind, job_title = @jobTitle, phone = @phone,
                       salesman_id = @salesmanId, cashier_id = @cashierId, section_id = @sectionId, hire_date = @hireDate,
                       notes = @notes, is_active = @isActive, updated_at = SYSUTCDATETIME()
                WHERE id = @id
                """, p, cancellationToken: ct));
            if (n == 0) return (null, "الموظف غير موجود");
        }
        await MirrorSellerAccountAsync(conn, id.Value, ct);
        return (await GetAsync(id.Value, ct), null);
    }

    /// <summary>رمز دخول جديد من 6 أرقام.</summary>
    public async Task<StaffDto?> IssuePinAsync(long id, CancellationToken ct)
    {
        var pin = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
        var hash = BCrypt.Net.BCrypt.HashPassword(pin);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_staff SET pin_hash = @hash, pin_display = @pin, updated_at = SYSUTCDATETIME() WHERE id = @id",
            new { id, hash, pin }, cancellationToken: ct));
        if (n == 0) return null;
        await MirrorSellerAccountAsync(conn, id, ct);
        return await GetAsync(id, ct);
    }

    public async Task<StaffDto?> SetActiveAsync(long id, bool active, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_staff SET is_active = @active, updated_at = SYSUTCDATETIME() WHERE id = @id", new { id, active }, cancellationToken: ct));
        if (n == 0) return null;
        await MirrorSellerAccountAsync(conn, id, ct);
        return await GetAsync(id, ct);
    }

    /// <summary>فك ربط الجهاز — يسمح للموظف بالدخول من هاتف جديد.</summary>
    public async Task<StaffDto?> ResetDeviceAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE ext_staff SET device_id = NULL, device_label = NULL, device_bound_at = NULL, updated_at = SYSUTCDATETIME() WHERE id = @id",
            new { id }, cancellationToken: ct));
        return n == 0 ? null : await GetAsync(id, ct);
    }

    /// <summary>الخادم يبلّغ عن أول جهاز دخل به الموظف — يُحفظ هنا ليظهر في لوحة التحكم.</summary>
    public async Task BindDeviceAsync(long id, string deviceId, string? label, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_staff SET device_id = @deviceId, device_label = @label, device_bound_at = SYSUTCDATETIME()
            WHERE id = @id AND device_id IS NULL
            """, new { id, deviceId, label = Clean(label, 200) }, cancellationToken: ct));
    }

    /// <summary>استيراد الكاشيرية الذين ليس لهم موظف بعد (الكود = c + رقم الكاشير).</summary>
    public async Task<int> ImportCashiersAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO ext_staff (code, name, kind, cashier_id, section_id, job_title)
            SELECT N'c' + CAST(c.id AS NVARCHAR(18)),
                   COALESCE(NULLIF(LTRIM(RTRIM(c.account_name)), N''), NULLIF(LTRIM(RTRIM(c.username)), N''), N'كاشير #' + CAST(c.id AS NVARCHAR(18))),
                   N'cashier', c.id, NULLIF(c.section_id, 0), N'كاشير'
            FROM cashiers c
            WHERE NOT EXISTS (SELECT 1 FROM ext_staff s WHERE s.cashier_id = c.id)
              AND NOT EXISTS (SELECT 1 FROM ext_staff s WHERE s.code = N'c' + CAST(c.id AS NVARCHAR(18)))
            """, cancellationToken: ct));
    }

    /// <summary>موظفو المزامنة مع خادم الفريق (بلا الرمز الظاهر).</summary>
    public async Task<IReadOnlyList<StaffSyncDto>> ListSyncAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT s.id AS Id, s.code AS Code, s.name AS Name, s.kind AS Kind, s.job_title AS JobTitle,
                   s.photo_url AS PhotoUrl, s.salesman_id AS SalesmanId, s.cashier_id AS CashierId,
                   s.section_id AS SectionId, sec.name AS SectionName, s.pin_hash AS PinHash, s.is_active AS IsActive,
                   s.device_id AS DeviceId
            FROM ext_staff s
            LEFT JOIN sections sec ON sec.id = s.section_id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryAsync<StaffSyncDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    /// <summary>
    /// موظف مربوط ببائع: حساب ويب البائع القديم يبقى متطابقاً (نفس الرمز والتفعيل) حتى يكتمل الانتقال للتطبيق.
    /// </summary>
    private static async Task MirrorSellerAccountAsync(System.Data.IDbConnection conn, long staffId, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition("""
            MERGE ext_seller_accounts AS t
            USING (SELECT salesman_id, pin_hash, pin_display, is_active FROM ext_staff
                   WHERE id = @staffId AND salesman_id IS NOT NULL AND pin_hash IS NOT NULL) AS s
            ON t.salesman_id = s.salesman_id
            WHEN MATCHED THEN UPDATE SET pin_hash = s.pin_hash, pin_display = s.pin_display, is_active = s.is_active
            WHEN NOT MATCHED THEN INSERT (salesman_id, pin_hash, pin_display, must_change_pin, is_active)
                 VALUES (s.salesman_id, s.pin_hash, s.pin_display, 0, s.is_active);
            """, new { staffId }, cancellationToken: ct));
    }

    private static string? Clean(string? v, int max)
    {
        var t = v?.Trim();
        if (string.IsNullOrEmpty(t)) return null;
        return t.Length > max ? t[..max] : t;
    }
}
