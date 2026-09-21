using FOT.Pos.Infrastructure.Repositories;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Names are owned by Edari. This endpoint no longer copies HAYAT2025 over local rows.
/// </summary>
public sealed class EdariArabicNamesBackfillService(EdariSyncRepository syncRepo)
{
    public async Task<EdariArabicNamesBackfillResult> BackfillAsync(bool skipBranches = false, CancellationToken ct = default)
    {
        const string msg = "الأسماء تُجلب من الإداري فقط — استخدم جلب البيانات أو أزرار المزامنة";
        await syncRepo.LogOperationAsync("arabic_backfill", "success", msg, ct);
        return new EdariArabicNamesBackfillResult(true, msg, 0, 0, 0, 0, 0, DateTime.UtcNow);
    }
}

public sealed record EdariArabicNamesBackfillResult(
    bool Success,
    string Message,
    int ArticlesUpdated,
    int BranchesUpdated,
    int SectionsUpdated,
    int SalesmenUpdated,
    int SalesmenImported,
    DateTime FinishedAt);
