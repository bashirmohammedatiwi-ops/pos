using FOT.Pos.Api.Hubs;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Shared.Printing;
using Microsoft.AspNetCore.SignalR;

namespace FOT.Pos.Api.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/settings/print", async (PrintRepository repo) => await repo.GetSettingsAsync(default));
        api.MapPut("/settings/print", async (PrintRepository repo, UpdatePrintSettingsRequest req, IHubContext<PosHub> hub) =>
        {
            var saved = await repo.SaveSettingsAsync(req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Settings);
            return Results.Ok(saved);
        });
        api.MapGet("/settings/cashboxes", async (PosCashBoxSettingsRepository repo, CashBoxAccountRepository accounts) =>
            Results.Ok(await WithAccountLabelsAsync(await repo.GetAsync(default), accounts)));
        api.MapPut("/settings/cashboxes", async (PosCashBoxSettingsRepository repo, CashBoxAccountRepository accounts, UpdatePosCashBoxSettingsRequest req, IHubContext<PosHub> hub) =>
        {
            var saved = await repo.SaveAsync(req, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Settings);
            return Results.Ok(await WithAccountLabelsAsync(saved, accounts));
        });
        api.MapGet("/settings/business-period", async (BusinessPeriodSettingsRepository repo) =>
            Results.Ok(await repo.GetAsync(default)));
        api.MapPut("/settings/business-period", async (BusinessPeriodSettingsRepository repo, UpdateBusinessPeriodSettingsRequest req) =>
            Results.Ok(await repo.SaveAsync(req, default)));
        api.MapGet("/settings/print/preview", async (PrintRepository repo) =>
        {
            var s = await repo.GetSettingsAsync(default);
            return Results.Ok(ReceiptLayoutEngine.Sample(s));
        });
        api.MapPost("/settings/print/logo", async (HttpRequest request, PrintRepository repo, IHubContext<PosHub> hub) =>
        {
            if (!request.HasFormContentType)
                return Results.BadRequest(new { message = "multipart/form-data مطلوب" });
            var file = request.Form.Files.GetFile("file");
            if (file is null || file.Length == 0)
                return Results.BadRequest(new { message = "لم يُرفَع ملف" });
            if (file.Length > 2 * 1024 * 1024)
                return Results.BadRequest(new { message = "حجم الصورة كبير جداً (الحد 2MB)" });

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (ext is not ".png" and not ".jpg" and not ".jpeg" and not ".webp" and not ".gif")
                return Results.BadRequest(new { message = "صيغة غير مدعومة — استخدم PNG أو JPG" });

            var dir = FotDataPaths.ReceiptUploads;
            Directory.CreateDirectory(dir);
            foreach (var old in Directory.GetFiles(dir, "logo.*"))
                File.Delete(old);

            var savePath = Path.Combine(dir, "logo" + ext);
            await using (var stream = File.Create(savePath))
                await file.CopyToAsync(stream);

            var url = $"/uploads/receipt/logo{ext}";
            var saved = await repo.SetLogoUrlAsync(url, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Settings);
            return Results.Ok(saved);
        }).DisableAntiforgery();
        api.MapDelete("/settings/print/logo", async (PrintRepository repo, IHubContext<PosHub> hub) =>
        {
            var dir = FotDataPaths.ReceiptUploads;
            if (Directory.Exists(dir))
            {
                foreach (var old in Directory.GetFiles(dir, "logo.*"))
                    File.Delete(old);
            }
            var saved = await repo.SetLogoUrlAsync(null, default);
            await PosHubEvents.NotifyCatalogUpdated(hub, CatalogScopes.Settings);
            return Results.Ok(saved);
        });
    }

    /// <summary>
    /// Fills the display Num/Name labels for the stored card/gift accounts. The stored values
    /// are Edari account Seqs (e.g. 1915 → «301 بطاقة QiCard»), and the local accounts mirror
    /// is empty, so labels must come from Edari itself. Settings stay readable even when Edari
    /// is down: the lookup failure is swallowed and the raw Seq shows instead.
    /// </summary>
    private static async Task<PosCashBoxSettingsDto> WithAccountLabelsAsync(
        PosCashBoxSettingsDto dto, CashBoxAccountRepository accounts)
    {
        var giftSeq = dto.GiftMasterAccount ?? 0;
        if (giftSeq == 0 && dto.EdariGiftAccount > 0 && dto.EdariGiftAccount != 3133)
            giftSeq = dto.EdariGiftAccount;
        var qiEdariSeq = dto.EdariQiAccount;

        var seqs = new List<long>();
        if (dto.QiMasterAccount is > 0) seqs.Add(dto.QiMasterAccount.Value);
        if (giftSeq > 0) seqs.Add(giftSeq);
        if (qiEdariSeq > 0) seqs.Add(qiEdariSeq);
        if (seqs.Count == 0)
            return dto;

        IReadOnlyList<EdariCreditAccountRow> rows;
        try
        {
            rows = await accounts.LookupBySeqsAsync(seqs, default);
        }
        catch
        {
            return dto;
        }

        var bySeq = rows.GroupBy(r => r.Seq).ToDictionary(g => g.Key, g => g.First());
        string? qiNum = null, qiName = null, giftNum = null, giftName = null, qiEdariNum = null, qiEdariName = null;
        if (dto.QiMasterAccount is > 0 && bySeq.TryGetValue(dto.QiMasterAccount.Value, out var qi))
        {
            qiNum = string.IsNullOrWhiteSpace(qi.Num) ? null : qi.Num.Trim();
            qiName = string.IsNullOrWhiteSpace(qi.Name) ? null : qi.Name.Trim();
        }
        if (giftSeq > 0 && bySeq.TryGetValue(giftSeq, out var gift))
        {
            giftNum = string.IsNullOrWhiteSpace(gift.Num) ? null : gift.Num.Trim();
            giftName = string.IsNullOrWhiteSpace(gift.Name) ? null : gift.Name.Trim();
        }
        if (qiEdariSeq > 0 && bySeq.TryGetValue(qiEdariSeq, out var qiEdari))
        {
            qiEdariNum = string.IsNullOrWhiteSpace(qiEdari.Num) ? null : qiEdari.Num.Trim();
            qiEdariName = string.IsNullOrWhiteSpace(qiEdari.Name) ? null : qiEdari.Name.Trim();
        }

        return dto with
        {
            QiMasterAccountNum = qiNum,
            QiMasterAccountName = qiName,
            GiftMasterAccountNum = giftNum,
            GiftMasterAccountName = giftName,
            EdariQiAccountNum = qiEdariNum,
            EdariQiAccountName = qiEdariName,
        };
    }
}
