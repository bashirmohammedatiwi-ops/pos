using Dapper;

using FOT.Pos.Infrastructure.Data;

using FOT.Pos.Infrastructure.Repositories;

using FOT.Pos.Infrastructure.Services;

namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariSalesmenSyncService(
    EdariNexusClient nexus,
    EdariSettingsService settings,
    ISqlConnectionFactory db,
    EdariSyncRepository syncRepo,
    EdariDashboardCache dashboardCache)
{
    public async Task<EdariSalesmenSyncResult> SyncAsync(CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
        {
            return new EdariSalesmenSyncResult(
                false, "تكامل الإداري معطّل", 0, 0, 0, DateTime.UtcNow);
        }

        if (!EdariConnectionFactory.DataFolderExists(opts))
        {
            return new EdariSalesmenSyncResult(
                false, $"مجلد النسخة غير موجود: {opts.YearFolder}", 0, 0, 0, DateTime.UtcNow);
        }

        IReadOnlyList<EdariSellerRow> sellers;
        try
        {
            sellers = await nexus.GetSalesmenAsync(ct);
        }
        catch (Exception ex)
        {
            var msg = EdariNexusClient.FormatConnectionError(ex);
            await syncRepo.LogOperationAsync("salesmen_sync", "failed", msg, ct);
            return new EdariSalesmenSyncResult(false, msg, 0, 0, 0, DateTime.UtcNow);
        }

        if (sellers.Count == 0)
        {
            const string emptyMsg = "لا أسماء بائعين في سجل الإداري — لم يُغيَّر شيء";
            await syncRepo.LogOperationAsync("salesmen_sync", "success", emptyMsg, ct);
            return new EdariSalesmenSyncResult(true, emptyMsg, 0, 0, 0, DateTime.UtcNow);
        }

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        SalesmanQueries.ResetSchemaCache();

        var hasRegistry = await SalesmanQueries.HasEdariRegistryAsync(conn, ct);
        var hasSortNum = await SalesmanQueries.HasSortNumAsync(conn, ct);
        var hasIsEdari = await SalesmanQueries.HasIsEdariAsync(conn, ct);

        var added = 0;
        var updated = 0;
        var sortNum = 0;
        var edariIds = new List<long>(sellers.Count);
        var registryRows = new List<object>(sellers.Count);

        foreach (var seller in sellers)
        {
            sortNum++;
            edariIds.Add(seller.Seq);
            registryRows.Add(new { Id = seller.Seq, SortNum = sortNum });

            var name = ResolveName(seller);

            var exists = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
                "SELECT id FROM salesmen WHERE id = @id", new { id = seller.Seq }, cancellationToken: ct));

            if (exists.HasValue)
            {
                var previous = await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
                    "SELECT LTRIM(RTRIM(CONVERT(NVARCHAR(200), name))) FROM salesmen WHERE id = @id",
                    new { id = seller.Seq }, cancellationToken: ct));
                await conn.ExecuteAsync(new CommandDefinition(
                    BuildUpdateSql(hasSortNum, hasIsEdari),
                    new { id = seller.Seq, name, sortNum }, cancellationToken: ct));
                if (!string.Equals(previous, name, StringComparison.Ordinal))
                    updated++;
                continue;
            }

            await conn.ExecuteAsync(new CommandDefinition(
                BuildInsertSql(hasSortNum, hasIsEdari),
                new { id = seller.Seq, name, sortNum }, cancellationToken: ct));
            added++;
        }

        if (hasRegistry && registryRows.Count > 0)
        {
            await conn.ExecuteAsync(new CommandDefinition("DELETE FROM ext_edari_salesmen", cancellationToken: ct));
            await conn.ExecuteAsync(new CommandDefinition(
                "INSERT INTO ext_edari_salesmen (salesman_id, sort_num) VALUES (@Id, @SortNum)",
                registryRows,
                cancellationToken: ct));
        }

        if (edariIds.Count > 0)
        {
            if (hasIsEdari)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE salesmen SET is_edari = 0, sort_num = NULL WHERE id NOT IN @ids",
                    new { ids = edariIds }, cancellationToken: ct));
            }
            else if (hasSortNum)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE salesmen SET sort_num = NULL WHERE id NOT IN @ids",
                    new { ids = edariIds }, cancellationToken: ct));
            }

            await conn.ExecuteAsync(new CommandDefinition("""
                DELETE sm
                FROM salesmen sm
                WHERE sm.id > @maxId
                  AND sm.id NOT IN @ids
                  AND NOT EXISTS (SELECT 1 FROM reciepts r WHERE r.salesman = sm.id)
                  AND NOT EXISTS (SELECT 1 FROM reciept_items ri WHERE ri.salesman_id = sm.id)
                  AND NOT EXISTS (SELECT 1 FROM ext_commission_calculations c WHERE c.salesman_id = sm.id)
                """, new { maxId = EdariSalesmenConstants.MaxId, ids = edariIds }, cancellationToken: ct));
        }

        SalesmanQueries.ResetSchemaCache();
        var visibleCount = hasRegistry
            ? await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM ext_edari_salesmen",
                cancellationToken: ct))
            : hasIsEdari
                ? await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                    "SELECT COUNT(*) FROM salesmen WHERE is_edari = 1",
                    cancellationToken: ct))
                : sellers.Count;
        dashboardCache.Invalidate();

        var registryCount = hasRegistry ? registryRows.Count : 0;
        var message = registryCount > 0
            ? $"تمت مزامنة {sellers.Count} بائع من الإداري — {added} جديد، {updated} محدّث · السجل {registryCount} · المعروض {visibleCount}"
            : $"تمت مزامنة {sellers.Count} بائع من الإداري — {added} جديد، {updated} محدّث · المعروض {visibleCount}";

        await syncRepo.LogOperationAsync("salesmen_sync", "success", message, ct);
        return new EdariSalesmenSyncResult(true, message, added, updated, sellers.Count, DateTime.UtcNow);
    }

    private static string BuildUpdateSql(bool hasSortNum, bool hasIsEdari)
    {
        var sets = new List<string> { "name = @name" };
        if (hasSortNum) sets.Add("sort_num = @sortNum");
        if (hasIsEdari) sets.Add("is_edari = 1");
        return $"UPDATE salesmen SET {string.Join(", ", sets)} WHERE id = @id";
    }

    private static string BuildInsertSql(bool hasSortNum, bool hasIsEdari)
    {
        var cols = new List<string> { "id", "name", "password" };
        var vals = new List<string> { "@id", "@name", "N''" };
        if (hasSortNum)
        {
            cols.Add("sort_num");
            vals.Add("@sortNum");
        }
        if (hasIsEdari)
        {
            cols.Add("is_edari");
            vals.Add("1");
        }

        return $"""
            SET IDENTITY_INSERT salesmen ON;
            INSERT INTO salesmen ({string.Join(", ", cols)}) VALUES ({string.Join(", ", vals)});
            SET IDENTITY_INSERT salesmen OFF;
            """;
    }

    private static string ResolveName(EdariSellerRow seller)
    {
        var direct = EdariStringHelper.Normalize(seller.Name);
        if (EdariStringHelper.IsReadableName(direct))
            return direct!;

        var num = EdariStringHelper.Normalize(seller.Num);
        if (EdariStringHelper.IsReadableName(num))
            return num!;

        return $"{seller.Seq}-";
    }
}
