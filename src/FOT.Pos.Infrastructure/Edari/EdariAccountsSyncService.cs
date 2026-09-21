using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Mirrors the Edari chart of accounts (File11n, Cod=1) into ext_edari_accounts so the control
/// panel can list and search cash boxes instantly — including boxes created in Edari minutes ago,
/// which the old live-only search could not find because Arabic names arrive destroyed from the
/// ADO provider. Names are repaired from Edari File11n via the UTF-8 text channel.
/// </summary>
public sealed class EdariAccountsSyncService(
    EdariNexusClient nexus,
    EdariTextQueryService textQuery,
    EdariSettingsService settings,
    ISqlConnectionFactory db,
    EdariSyncRepository syncRepo)
{
    public async Task<EdariAccountsSyncResult> SyncAsync(CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
            return new EdariAccountsSyncResult(false, "تكامل الإداري معطّل", 0, 0, 0, 0, DateTime.UtcNow);

        IReadOnlyList<EdariChartAccountRow> rows;
        try
        {
            rows = await nexus.GetPostingAccountsAsync(ct);
        }
        catch (Exception ex)
        {
            var failure = EdariNexusClient.FormatConnectionError(ex);
            await syncRepo.LogOperationAsync("accounts_sync", "failed", failure, ct);
            return new EdariAccountsSyncResult(false, failure, 0, 0, 0, 0, DateTime.UtcNow);
        }

        if (rows.Count == 0)
        {
            const string empty = "لا حسابات في الإداري";
            await syncRepo.LogOperationAsync("accounts_sync", "success", empty, ct);
            return new EdariAccountsSyncResult(true, empty, 0, 0, 0, 0, DateTime.UtcNow);
        }

        var arabic = await LoadArabicNamesAsync(ct);

        // Root order decides what the picker shows first: the shop's own cash boxes (100) come
        // before the delivery folders, which hold hundreds of customer accounts and would
        // otherwise bury the boxes the user is actually looking for.
        var rootOrder = SectionPostingAccountRoots.RootNums
            .Select((num, index) => (num, index))
            .ToDictionary(x => x.num, x => x.index, StringComparer.OrdinalIgnoreCase);

        var payload = new List<AccountUpsertRow>(rows.Count);
        var withinRoot = new Dictionary<int, int>();
        foreach (var row in rows)
        {
            var num = row.Num?.Trim();
            var name = ResolveName(row.Seq, row.Name, arabic)
                ?? (string.IsNullOrWhiteSpace(num) ? $"حساب {row.Seq}" : $"حساب {num}");
            var groupNum = row.GroupNum?.Trim();
            var isCashBox = !string.IsNullOrEmpty(groupNum) && rootOrder.ContainsKey(groupNum);
            var bucket = isCashBox ? rootOrder[groupNum!] : rootOrder.Count;
            withinRoot.TryGetValue(bucket, out var seen);
            withinRoot[bucket] = seen + 1;

            payload.Add(new AccountUpsertRow
            {
                EdariSeq = row.Seq,
                AccountNum = Truncate(num, 60),
                AccountName = Truncate(name, 300),
                GroupNum = Truncate(groupNum, 60),
                GroupName = Truncate(ResolveName(row.Master, row.GroupName, arabic), 300),
                IsCashBox = isCashBox,
                Closed = row.Closed,
                Balance = row.Balance,
                SortOrder = bucket * 100_000 + seen,
            });
        }

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var before = await conn.ExecuteScalarAsync<int>(
            new CommandDefinition("SELECT COUNT(*) FROM ext_edari_accounts", cancellationToken: ct));

        // Chunked so a 1,000-account chart never blows past the 2,100 parameter ceiling.
        foreach (var chunk in payload.Chunk(200))
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                MERGE ext_edari_accounts AS t
                USING (SELECT @EdariSeq AS edari_seq) AS s ON t.edari_seq = s.edari_seq
                WHEN MATCHED THEN UPDATE SET
                    account_num = @AccountNum, account_name = @AccountName,
                    group_num = @GroupNum, group_name = @GroupName,
                    is_cashbox = @IsCashBox, closed = @Closed,
                    balance = @Balance, sort_order = @SortOrder,
                    updated_at = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN INSERT
                    (edari_seq, account_num, account_name, group_num, group_name,
                     is_cashbox, closed, balance, sort_order, updated_at)
                    VALUES (@EdariSeq, @AccountNum, @AccountName, @GroupNum, @GroupName,
                            @IsCashBox, @Closed, @Balance, @SortOrder, SYSUTCDATETIME());
                """, chunk, cancellationToken: ct));
        }

        // Accounts deleted in Edari must disappear here too, otherwise the picker keeps offering
        // a Seq that no longer posts anywhere. Staged through a temp table because the live list
        // is far past Dapper's IN-clause parameter ceiling.
        await conn.ExecuteAsync(new CommandDefinition(
            "CREATE TABLE #live_accounts (edari_seq BIGINT NOT NULL PRIMARY KEY)", cancellationToken: ct));
        foreach (var chunk in payload.Select(p => new { p.EdariSeq }).Chunk(500))
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "INSERT INTO #live_accounts (edari_seq) VALUES (@EdariSeq)", chunk, cancellationToken: ct));
        }
        var removed = await conn.ExecuteAsync(new CommandDefinition("""
            DELETE FROM ext_edari_accounts
            WHERE edari_seq NOT IN (SELECT edari_seq FROM #live_accounts);
            DROP TABLE #live_accounts;
            """, cancellationToken: ct));

        var total = await conn.ExecuteScalarAsync<int>(
            new CommandDefinition("SELECT COUNT(*) FROM ext_edari_accounts", cancellationToken: ct));
        var linkable = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM ext_edari_accounts WHERE is_cashbox = 1 AND closed = 0", cancellationToken: ct));
        var shopBoxes = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM ext_edari_accounts WHERE is_cashbox = 1 AND closed = 0 AND group_num = @root",
            new { root = SectionPostingAccountRoots.CashBoxRootNum }, cancellationToken: ct));

        var added = Math.Max(0, total - before + removed);
        var msg = $"حسابات الإداري: {total} حساب · {shopBoxes} صندوق محل · {linkable} حساب قابل للربط"
            + (added > 0 ? $" · جديد {added}" : "")
            + (removed > 0 ? $" · محذوف {removed}" : "")
            + (arabic.Count > 0 ? " · أسماء عربية من الإداري" : "");
        await syncRepo.LogOperationAsync("accounts_sync", "success", msg, ct);

        return new EdariAccountsSyncResult(true, msg, total, shopBoxes, added, removed, DateTime.UtcNow);
    }

    /// <summary>Arabic names straight from Edari — the only channel that preserves them.</summary>
    private async Task<Dictionary<long, string>> LoadArabicNamesAsync(CancellationToken ct)
    {
        var map = new Dictionary<long, string>();
        try
        {
            var rows = await textQuery.QueryAsync(
                "SELECT Seq, Name1 FROM File11n WHERE Cod = 1 OR Cod = 2", ct);
            foreach (var row in rows)
            {
                if (row.Length < 2) continue;
                if (!long.TryParse(row[0], out var seq)) continue;
                var name = EdariStringHelper.Normalize(row[1]);
                if (!string.IsNullOrWhiteSpace(name) && EdariStringHelper.IsReadableName(name))
                    map[seq] = name!;
            }
        }
        catch
        {
            /* Arabic channel unavailable — account numbers still give usable labels */
        }
        return map;
    }

    private static string? ResolveName(
        long seq,
        string? edariRaw,
        Dictionary<long, string> arabic)
    {
        if (arabic.TryGetValue(seq, out var fromEdari)) return fromEdari;
        var normalized = EdariStringHelper.Normalize(edariRaw);
        return EdariStringHelper.IsReadableName(normalized) ? normalized : null;
    }

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null
        : value.Length <= max ? value
        : value[..max];

    private sealed class AccountUpsertRow
    {
        public long EdariSeq { get; init; }
        public string? AccountNum { get; init; }
        public string? AccountName { get; init; }
        public string? GroupNum { get; init; }
        public string? GroupName { get; init; }
        public bool IsCashBox { get; init; }
        public bool Closed { get; init; }
        public decimal Balance { get; init; }
        public int SortOrder { get; init; }
    }
}

public sealed record EdariAccountsSyncResult(
    bool Success,
    string Message,
    int Total,
    int CashBoxes,
    int Added,
    int Removed,
    DateTime FinishedAt);
