using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;

namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariBranchesSyncService(
    EdariNexusClient nexus,
    EdariSettingsService settings,
    ISqlConnectionFactory db,
    EdariSyncRepository syncRepo,
    EdariDashboardCache dashboardCache)
{
    public async Task<EdariBranchesSyncResult> SyncAsync(CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
            return new EdariBranchesSyncResult(false, "تكامل الإداري معطّل", 0, 0, 0, DateTime.UtcNow);

        if (!EdariConnectionFactory.DataFolderExists(opts))
        {
            var msg = $"مجلد النسخة غير موجود: {opts.YearFolder}";
            await syncRepo.LogOperationAsync("branches_sync", "failed", msg, ct);
            return new EdariBranchesSyncResult(false, msg, 0, 0, 0, DateTime.UtcNow);
        }

        IReadOnlyList<EdariBranchRow> branches;
        try
        {
            branches = await nexus.GetBranchesAsync(ct);
        }
        catch (Exception ex)
        {
            var msg = EdariNexusClient.FormatConnectionError(ex);
            await syncRepo.LogOperationAsync("branches_sync", "failed", msg, ct);
            return new EdariBranchesSyncResult(false, msg, 0, 0, 0, DateTime.UtcNow);
        }

        if (branches.Count == 0)
        {
            await syncRepo.LogOperationAsync("branches_sync", "success", "لا فروع في Edari", ct);
            return new EdariBranchesSyncResult(true, "لا فروع في Edari", 0, 0, 0, DateTime.UtcNow);
        }

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var edariUpserts = 0;
        var sectionsCreated = 0;

        foreach (var branch in branches)
        {
            var name = branch.SyncName;
            var edariId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
                "SELECT id FROM edari_branches WHERE erp_seq = @seq",
                new { seq = branch.Seq }, cancellationToken: ct));

            if (edariId.HasValue)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE edari_branches SET name = @name WHERE id = @id",
                    new { id = edariId.Value, name }, cancellationToken: ct));
            }
            else
            {
                edariId = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                    INSERT INTO edari_branches (erp_seq, name)
                    OUTPUT INSERTED.id
                    VALUES (@seq, @name)
                    """, new { seq = branch.Seq, name }, cancellationToken: ct));
                edariUpserts++;
            }

            var branchId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
                """
                SELECT TOP 1 b.id FROM branches b
                INNER JOIN sections s ON s.branch_id = b.id
                WHERE s.edari_branch_id = @edariSeq
                """,
                new { edariSeq = branch.Seq }, cancellationToken: ct));

            if (!branchId.HasValue)
            {
                branchId = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                    INSERT INTO branches (name, state)
                    OUTPUT INSERTED.id
                    VALUES (@name, 1)
                    """, new { name }, cancellationToken: ct));
            }
            else
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE branches SET name = @name WHERE id = @id",
                    new { id = branchId.Value, name }, cancellationToken: ct));
            }

            var sectionExists = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM sections WHERE edari_branch_id = @edariSeq",
                new { edariSeq = branch.Seq }, cancellationToken: ct));

            if (sectionExists == 0)
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO sections (name, branch_id, state, sell_price, edari_branch_id, edari_warehouse_number)
                    VALUES (@name, @branchId, 1, 1, @edariSeq, 1)
                    """, new { name, branchId = branchId!.Value, edariSeq = branch.Seq }, cancellationToken: ct));
                sectionsCreated++;
            }
            else
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE sections SET name = @name WHERE edari_branch_id = @edariSeq",
                    new { name, edariSeq = branch.Seq }, cancellationToken: ct));
            }
        }

        dashboardCache.Invalidate();
        var message =
            $"تمت مزامنة {branches.Count} فرع Edari — {edariUpserts} جديد، {sectionsCreated} قسم جديد";
        await syncRepo.LogOperationAsync("branches_sync", "success", message, ct);
        return new EdariBranchesSyncResult(true, message, branches.Count, edariUpserts, sectionsCreated, DateTime.UtcNow);
    }
}

public sealed record EdariBranchesSyncResult(
    bool Success,
    string Message,
    int BranchCount,
    int EdariBranchesAdded,
    int SectionsCreated,
    DateTime FinishedAt);
