namespace FOT.Pos.Infrastructure.Edari;

using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

public sealed record EdariBranchPushResult(int EdariBranchSeq, bool Created, string Message);

public sealed class EdariSectionPushService(
    EdariNexusClient nexus,
    Services.EdariSettingsService settings,
    Data.ISqlConnectionFactory db,
    HayatLegacyNameService hayatNames)
{
    public async Task<EdariBranchPushResult> PushCreateAsync(CreateSectionRequest req, CancellationToken ct)
    {
        await EnsureEnabledAsync(ct);
        var defaultCash = GetDefaultCashBox(req.CashBoxes!);

        if (req.EdariBranchId.HasValue && req.EdariBranchId.Value > 0)
        {
            var edariSeq = req.EdariBranchId.Value;
            var branchName = req.Name.Trim();
            await nexus.UpdateBranchAsync(edariSeq, branchName, req.EdariSymbol, defaultCash.MasterAccount, ct);
            await nexus.EnsureBranchPostingAccountsAsync(edariSeq, ct);
            await UpsertLocalEdariBranchAsync(edariSeq, branchName, ct);
            await hayatNames.UpsertBranchNameAsync(edariSeq, branchName, ct);
            return new EdariBranchPushResult(edariSeq, false, $"تم تحديث فرع Edari #{edariSeq}");
        }

        var newSeq = await nexus.CreateBranchAsync(req.Name.Trim(), req.EdariSymbol, defaultCash.MasterAccount, ct);
        await nexus.EnsureBranchPostingAccountsAsync(newSeq, ct);
        var createdName = req.Name.Trim();
        await UpsertLocalEdariBranchAsync((int)newSeq, createdName, ct);
        await hayatNames.UpsertBranchNameAsync(newSeq, createdName, ct);
        return new EdariBranchPushResult((int)newSeq, true, $"تم إنشاء فرع Edari #{newSeq}");
    }

    public async Task<EdariBranchPushResult> PushUpdateAsync(int edariBranchId, string name, string? symbol,
        IReadOnlyList<SectionCashBoxAssignment> cashBoxes, CancellationToken ct)
    {
        await EnsureEnabledAsync(ct);
        if (edariBranchId <= 0)
            throw new InvalidOperationException("القسم غير مربوط بفرع Edari");

        var defaultCash = GetDefaultCashBox(cashBoxes);
        var branchName = name.Trim();
        await nexus.UpdateBranchAsync(edariBranchId, branchName, symbol, defaultCash.MasterAccount, ct);
        await nexus.EnsureBranchPostingAccountsAsync(edariBranchId, ct);
        await UpsertLocalEdariBranchAsync(edariBranchId, branchName, ct);
        await hayatNames.UpsertBranchNameAsync(edariBranchId, branchName, ct);
        return new EdariBranchPushResult(edariBranchId, false, $"تم ترحيل التعديل إلى Edari (#{edariBranchId})");
    }

    private async Task EnsureEnabledAsync(CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
            throw new InvalidOperationException("تكامل Edari معطّل — فعّله من إعدادات Edari");
        if (!EdariConnectionFactory.DataFolderExists(opts))
            throw new InvalidOperationException($"مجلد Edari غير موجود: {opts.YearFolder}");
    }

    private static SectionCashBoxAssignment GetDefaultCashBox(IReadOnlyList<SectionCashBoxAssignment> boxes)
    {
        if (boxes.Count == 0)
            throw new InvalidOperationException("أضف صندوقاً واحداً على الأقل");
        return boxes.FirstOrDefault(b => b.IsDefault) ?? boxes[0];
    }

    private async Task UpsertLocalEdariBranchAsync(int edariSeq, string name, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var id = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT id FROM edari_branches WHERE erp_seq = @seq",
            new { seq = edariSeq }, cancellationToken: ct));

        if (id.HasValue)
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE edari_branches SET name = @name WHERE id = @id",
                new { id = id.Value, name }, cancellationToken: ct));
            return;
        }

        await conn.ExecuteAsync(new CommandDefinition(
            "INSERT INTO edari_branches (erp_seq, name) VALUES (@seq, @name)",
            new { seq = edariSeq, name }, cancellationToken: ct));
    }
}
