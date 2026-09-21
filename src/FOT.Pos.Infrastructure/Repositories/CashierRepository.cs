using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class CashierRepository(
    ISqlConnectionFactory db, PermissionsRepository permissions, CashBoxAccountRepository cashBoxes,
    CreditAccountRepository credits)
{
    private const string SelectColumns = """
        c.id AS Id, c.username AS Username, c.account_name AS AccountName,
        CAST(c.state AS bit) AS Active, c.cashiers_permissions_id AS PermissionsId,
        p.name AS PermissionsName,
        COALESCE(c.section_id, 0) AS SectionId,
        s.name AS SectionName
        """;

    public async Task<PagedResult<CashierDto>> ListAsync(int page, int pageSize, string? search, CancellationToken ct)
    {
        var where = string.IsNullOrWhiteSpace(search)
            ? ""
            : "WHERE c.username LIKE @q OR c.account_name LIKE @q OR s.name LIKE @q";
        var sql = $"""
            SELECT {SelectColumns}
            FROM cashiers c
            LEFT JOIN cashiers_permissions p ON p.id = c.cashiers_permissions_id
            LEFT JOIN sections s ON s.id = c.section_id
            {where}
            ORDER BY c.username
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            SELECT COUNT(*) FROM cashiers c
            LEFT JOIN sections s ON s.id = c.section_id
            {where};
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var q = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%";
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql,
            new { offset = (page - 1) * pageSize, pageSize, q }, cancellationToken: ct));
        var items = (await multi.ReadAsync<CashierDto>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return new PagedResult<CashierDto>(items, total, page, pageSize);
    }

    public async Task<CashierDto?> GetByIdAsync(long id, CancellationToken ct)
    {
        var sql = $"""
            SELECT {SelectColumns}
            FROM cashiers c
            LEFT JOIN cashiers_permissions p ON p.id = c.cashiers_permissions_id
            LEFT JOIN sections s ON s.id = c.section_id
            WHERE c.id = @id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<CashierDto>(
            new CommandDefinition(sql, new { id }, cancellationToken: ct));
    }

    public async Task<CashierDetailDto?> GetDetailAsync(long id, CancellationToken ct)
    {
        var cashier = await GetByIdAsync(id, ct);
        if (cashier is null) return null;

        var perms = await permissions.GetByIdAsync(cashier.PermissionsId, ct);
        if (perms is null) return null;

        var card = await GetCardCashBoxAsync(id, ct);
        string? cardName = null, cardNum = null;
        if (card?.MasterAccount is long seq && seq > 0)
        {
            var accounts = await cashBoxes.LookupBySeqsAsync([seq], ct);
            var account = accounts.FirstOrDefault();
            cardName = account?.Name;
            cardNum = account?.Num;
        }

        var flags = await GetFeatureFlagsAsync(id, ct);
        var salesmen = await GetAllowedSalesmenAsync(id, ct);
        var creditAccounts = await credits.ListForCashierAsync(id, ct);

        return new CashierDetailDto(
            cashier.Id, cashier.Username, cashier.AccountName, cashier.Active,
            cashier.SectionId, cashier.SectionName, perms,
            card?.MasterAccount, card?.MasterAccountBank, cardName, cardNum,
            flags.ApplyCommissions, flags.ApplyTargets, salesmen, creditAccounts);
    }

    /// <summary>
    /// Live permissions for a logged-in cashier — POS terminals poll this so admin edits
    /// apply without forcing the cashier to log out and back in.
    /// </summary>
    public async Task<CashierPermissionsDto?> GetPermissionsForCashierAsync(long cashierId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var permissionsId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT cashiers_permissions_id FROM cashiers WHERE id = @cashierId",
            new { cashierId }, cancellationToken: ct));
        if (permissionsId is null or <= 0) return null;
        return await permissions.GetByIdAsync(permissionsId.Value, ct);
    }

    /// <summary>Cash box that card sales for this cashier post to, when one is set.</summary>
    public async Task<CashierCardCashBox?> GetCardCashBoxAsync(long cashierId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<CashierCardCashBox>(new CommandDefinition("""
            SELECT card_master_account as MasterAccount,
                   COALESCE(card_master_account_bank, 0) as MasterAccountBank
            FROM cashiers WHERE id = @cashierId
            """, new { cashierId }, cancellationToken: ct));
        return row?.MasterAccount is > 0 ? row : null;
    }

    /// <summary>
    /// Current server sequence for the cashier's receipt numbers this year, so POS terminals can
    /// seed their local counters and print numbers that match the server before uploading. Returns
    /// 0 when the numbering schema is not installed yet.
    /// </summary>
    public async Task<int> GetCurrentReceiptSeqAsync(long cashierId, int year, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var seq = await conn.ExecuteScalarAsync<int?>(new CommandDefinition("""
                SELECT last_seq FROM receipt_number_sequences
                WHERE [year] = @year AND cashier_id = @cashierId
                """, new { year, cashierId }, cancellationToken: ct));
            return seq ?? 0;
        }
        catch
        {
            return 0;
        }
    }

    public async Task<long> CreateAsync(CreateCashierRequest req, CancellationToken ct)
    {
        if (req.SectionId <= 0)
            throw new InvalidOperationException("اختر قسم نقطة البيع");

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await EnsureSectionExistsAsync(conn, req.SectionId, ct);

        var exists = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM cashiers WHERE username = @username",
            new { username = req.Username.Trim() }, cancellationToken: ct));
        if (exists > 0)
            throw new InvalidOperationException("اسم المستخدم موجود مسبقاً");

        var pinTaken = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM cashiers WHERE password = @password",
            new { password = req.Password }, cancellationToken: ct));
        if (pinTaken > 0)
            throw new InvalidOperationException("رمز الدخول مستخدم من كاشير آخر — اختر رمزاً مختلفاً");

        var permId = await permissions.CreateAsync($"{req.Username.Trim()} — صلاحيات", req.Permissions, ct);

        var nextReceiptNum = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT ISNULL(MAX(receipt_num), 0) + 1 FROM cashiers WITH (UPDLOCK, HOLDLOCK)",
            cancellationToken: ct));

        var id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO cashiers (
                username, password, account_name, state, cashiers_permissions_id, section_id,
                card_master_account, card_master_account_bank, apply_commissions, apply_targets, receipt_num)
            OUTPUT INSERTED.id
            VALUES (
                @username, @password, @accountName, @active, @permissionsId, @sectionId,
                @cardMasterAccount, @cardMasterAccountBank, @applyCommissions, @applyTargets, @receiptNum)
            """, new
        {
            username = req.Username.Trim(),
            password = req.Password,
            accountName = req.AccountName?.Trim(),
            active = req.Active ? 1 : 0,
            permissionsId = permId,
            sectionId = req.SectionId,
            cardMasterAccount = req.CardMasterAccount is > 0 ? req.CardMasterAccount : null,
            cardMasterAccountBank = req.CardMasterAccount is > 0 ? req.CardMasterAccountBank ?? 0 : (int?)null,
            applyCommissions = req.ApplyCommissions ? 1 : 0,
            applyTargets = req.ApplyTargets ? 1 : 0,
            receiptNum = nextReceiptNum
        }, cancellationToken: ct));

        await ReplaceSalesmenAsync(conn, id, req.AllowedSalesmanIds, ct);
        await credits.ReplaceForCashierAsync(id, req.CreditAccounts, ct);
        return id;
    }

    public async Task UpdateAsync(long id, UpdateCashierRequest req, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var current = await conn.QuerySingleOrDefaultAsync<CashierIdentityRow>(new CommandDefinition("""
            SELECT id AS Id, username AS Username, cashiers_permissions_id AS PermissionsId
            FROM cashiers WHERE id = @id
            """, new { id }, cancellationToken: ct));
        if (current is null)
            throw new InvalidOperationException("الكاشير غير موجود");

        if (req.SectionId.HasValue && req.SectionId.Value <= 0)
            throw new InvalidOperationException("اختر قسم نقطة البيع");
        if (req.SectionId.HasValue)
            await EnsureSectionExistsAsync(conn, req.SectionId.Value, ct);

        if (!string.IsNullOrWhiteSpace(req.Username))
        {
            var exists = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM cashiers WHERE username = @username AND id <> @id",
                new { username = req.Username.Trim(), id }, cancellationToken: ct));
            if (exists > 0)
                throw new InvalidOperationException("اسم المستخدم موجود مسبقاً");
        }

        if (req.Permissions is not null)
            await permissions.UpdateAsync(current.PermissionsId, req.Permissions, ct);

        var username = string.IsNullOrWhiteSpace(req.Username) ? current.Username : req.Username.Trim();
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE cashiers SET
                username = COALESCE(@username, username),
                account_name = COALESCE(@accountName, account_name),
                password = CASE WHEN @password IS NULL OR @password = '' THEN password ELSE @password END,
                state = @active,
                section_id = COALESCE(@sectionId, section_id),
                card_master_account = CASE WHEN @clearCard = 1 THEN NULL
                                           ELSE COALESCE(@cardMasterAccount, card_master_account) END,
                card_master_account_bank = CASE WHEN @clearCard = 1 THEN NULL
                                                ELSE COALESCE(@cardMasterAccountBank, card_master_account_bank) END,
                apply_commissions = COALESCE(@applyCommissions, apply_commissions),
                apply_targets = COALESCE(@applyTargets, apply_targets)
            WHERE id = @id
            """, new
        {
            id,
            username = string.IsNullOrWhiteSpace(req.Username) ? null : req.Username.Trim(),
            accountName = req.AccountName?.Trim(),
            password = req.Password,
            active = req.Active ? 1 : 0,
            sectionId = req.SectionId,
            clearCard = req.ClearCardMasterAccount ? 1 : 0,
            cardMasterAccount = req.CardMasterAccount is > 0 ? req.CardMasterAccount : null,
            cardMasterAccountBank = req.CardMasterAccount is > 0 ? req.CardMasterAccountBank ?? 0 : (int?)null,
            applyCommissions = req.ApplyCommissions,
            applyTargets = req.ApplyTargets
        }, cancellationToken: ct));

        if (req.AllowedSalesmanIds is not null)
            await ReplaceSalesmenAsync(conn, id, req.AllowedSalesmanIds, ct);
        if (req.CreditAccounts is not null)
            await credits.ReplaceForCashierAsync(id, req.CreditAccounts, ct);

        if (!string.IsNullOrWhiteSpace(req.Username) || req.Permissions is not null)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE cashiers_permissions SET name = @name WHERE id = @permId",
                new { name = $"{username} — صلاحيات", permId = current.PermissionsId },
                cancellationToken: ct));
        }
    }

    public async Task DeactivateAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE cashiers SET state = 0 WHERE id = @id", new { id }, cancellationToken: ct));
    }

    public async Task<CashierAuthDto?> ValidateAsync(string username, string password, CancellationToken ct)
    {
        var name = username.Trim();
        const string where = """
            WHERE c.state = 1 AND (c.username = @username OR c.account_name = @username)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await QueryAuthRowAsync(conn, $"""
            SELECT c.id AS Id, c.username AS Username, c.account_name AS AccountName,
                   CAST(c.state AS bit) AS Active, c.cashiers_permissions_id AS PermissionsId,
                   COALESCE(c.section_id, 0) AS SectionId, s.name AS SectionName,
                   c.password AS Password,
                   CAST(COALESCE(c.apply_commissions, 1) AS bit) AS ApplyCommissions,
                   CAST(COALESCE(c.apply_targets, 1) AS bit) AS ApplyTargets,
                   COALESCE(c.receipt_num, 0) AS ReceiptNum
            FROM cashiers c
            LEFT JOIN sections s ON s.id = c.section_id
            {where}
            ORDER BY CASE WHEN c.username = @username THEN 0 ELSE 1 END
            """, new { username = name }, ct)
            ?? await QueryAuthRowAsync(conn, $"""
            SELECT c.id AS Id, c.username AS Username, c.account_name AS AccountName,
                   CAST(c.state AS bit) AS Active, c.cashiers_permissions_id AS PermissionsId,
                   COALESCE(c.section_id, 0) AS SectionId, s.name AS SectionName,
                   c.password AS Password,
                   CAST(1 AS bit) AS ApplyCommissions,
                   CAST(1 AS bit) AS ApplyTargets,
                   0 AS ReceiptNum
            FROM cashiers c
            LEFT JOIN sections s ON s.id = c.section_id
            {where}
            ORDER BY CASE WHEN c.username = @username THEN 0 ELSE 1 END
            """, new { username = name }, ct);
        if (row is null) return null;
        if (row.Password != password) return null;
        return ToAuthDto(row);
    }

    /// <summary>Device login: cashier enters PIN only (unique active password).</summary>
    public async Task<CashierAuthDto?> ValidateByPinAsync(string pin, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(pin)) return null;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await QueryAuthRowsAsync(conn, """
            SELECT c.id AS Id, c.username AS Username, c.account_name AS AccountName,
                   CAST(c.state AS bit) AS Active, c.cashiers_permissions_id AS PermissionsId,
                   COALESCE(c.section_id, 0) AS SectionId, s.name AS SectionName,
                   c.password AS Password,
                   CAST(COALESCE(c.apply_commissions, 1) AS bit) AS ApplyCommissions,
                   CAST(COALESCE(c.apply_targets, 1) AS bit) AS ApplyTargets,
                   COALESCE(c.receipt_num, 0) AS ReceiptNum
            FROM cashiers c
            LEFT JOIN sections s ON s.id = c.section_id
            WHERE c.state = 1 AND c.password = @pin
            """, new { pin }, ct);
        if (rows.Count == 0)
        {
            rows = await QueryAuthRowsAsync(conn, """
                SELECT c.id AS Id, c.username AS Username, c.account_name AS AccountName,
                       CAST(c.state AS bit) AS Active, c.cashiers_permissions_id AS PermissionsId,
                       COALESCE(c.section_id, 0) AS SectionId, s.name AS SectionName,
                       c.password AS Password,
                       CAST(1 AS bit) AS ApplyCommissions,
                       CAST(1 AS bit) AS ApplyTargets,
                       0 AS ReceiptNum
                FROM cashiers c
                LEFT JOIN sections s ON s.id = c.section_id
                WHERE c.state = 1 AND c.password = @pin
                """, new { pin }, ct);
        }
        if (rows.Count != 1) return null;
        return ToAuthDto(rows[0]);
    }

    private static async Task<CashierAuthRow?> QueryAuthRowAsync(
        System.Data.Common.DbConnection conn, string sql, object param, CancellationToken ct)
    {
        var rows = await QueryAuthRowsAsync(conn, sql, param, ct);
        return rows.FirstOrDefault();
    }

    private static async Task<List<CashierAuthRow>> QueryAuthRowsAsync(
        System.Data.Common.DbConnection conn, string sql, object param, CancellationToken ct)
    {
        try
        {
            return (await conn.QueryAsync<CashierAuthRow>(
                new CommandDefinition(sql, param, cancellationToken: ct))).ToList();
        }
        catch
        {
            return [];
        }
    }

    private static CashierAuthDto ToAuthDto(CashierAuthRow row) =>
        new(row.Id, row.Username, row.AccountName, row.Active, row.PermissionsId, row.SectionId, row.SectionName,
            row.ApplyCommissions, row.ApplyTargets, row.ReceiptNum);

    public async Task<(bool ApplyCommissions, bool ApplyTargets)> GetFeatureFlagsAsync(long cashierId, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            var row = await conn.QuerySingleOrDefaultAsync<FlagRow>(new CommandDefinition("""
                SELECT CAST(COALESCE(apply_commissions, 1) AS bit) AS ApplyCommissions,
                       CAST(COALESCE(apply_targets, 1) AS bit) AS ApplyTargets
                FROM cashiers WHERE id = @cashierId
                """, new { cashierId }, cancellationToken: ct));
            return row is null ? (true, true) : (row.ApplyCommissions, row.ApplyTargets);
        }
        catch
        {
            return (true, true);
        }
    }

    public async Task<IReadOnlyList<long>> GetAllowedSalesmanIdsAsync(long cashierId, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            return (await conn.QueryAsync<long>(new CommandDefinition(
                "SELECT salesman_id FROM cashier_salesmen WHERE cashier_id = @cashierId",
                new { cashierId }, cancellationToken: ct))).ToList();
        }
        catch
        {
            return [];
        }
    }

    public async Task<IReadOnlyList<SalesmanDto>> GetAllowedSalesmenAsync(long cashierId, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            return (await conn.QueryAsync<SalesmanDto>(new CommandDefinition("""
                SELECT s.id AS Id, s.name AS Name
                FROM cashier_salesmen cs
                INNER JOIN salesmen s ON s.id = cs.salesman_id
                WHERE cs.cashier_id = @cashierId
                ORDER BY s.name
                """, new { cashierId }, cancellationToken: ct))).ToList();
        }
        catch
        {
            return [];
        }
    }

    public async Task<IReadOnlyList<SalesmanDto>> RestrictSalesmenAsync(
        long cashierId, IReadOnlyList<SalesmanDto> all, CancellationToken ct)
    {
        var ids = await GetAllowedSalesmanIdsAsync(cashierId, ct);
        if (ids.Count == 0) return all;
        var set = ids.ToHashSet();
        return all.Where(s => set.Contains(s.Id)).ToList();
    }

    private static async Task ReplaceSalesmenAsync(
        System.Data.Common.DbConnection conn, long cashierId, IReadOnlyList<long>? ids, CancellationToken ct)
    {
        if (ids is null) return;
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM cashier_salesmen WHERE cashier_id = @cashierId",
            new { cashierId }, cancellationToken: ct));
        var distinct = ids.Where(x => x > 0).Distinct().ToList();
        foreach (var salesmanId in distinct)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO cashier_salesmen (cashier_id, salesman_id)
                VALUES (@cashierId, @salesmanId)
                """, new { cashierId, salesmanId }, cancellationToken: ct));
        }
    }

    private static async Task EnsureSectionExistsAsync(System.Data.Common.DbConnection conn, long sectionId, CancellationToken ct)
    {
        var exists = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM sections WHERE id = @id", new { id = sectionId }, cancellationToken: ct));
        if (exists == 0)
            throw new InvalidOperationException("القسم غير موجود");
    }

    public sealed record CashierCardCashBox
    {
        public long? MasterAccount { get; init; }
        public int MasterAccountBank { get; init; }
    }

    private sealed record CashierIdentityRow(long Id, string Username, long PermissionsId);
    private sealed record FlagRow(bool ApplyCommissions, bool ApplyTargets);
    private sealed record CashierAuthRow(
        long Id, string Username, string? AccountName, bool Active, long PermissionsId,
        long SectionId, string? SectionName, string Password,
        bool ApplyCommissions, bool ApplyTargets, int ReceiptNum);
}

public sealed record CashierAuthDto(
    long Id, string Username, string? AccountName, bool Active, long PermissionsId,
    long SectionId, string? SectionName,
    bool ApplyCommissions = true,
    bool ApplyTargets = true,
    int ReceiptNum = 0);
