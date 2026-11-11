using System.Data.Common;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Finds out which POS receipts Edari has merged. Every receipt we post becomes its own FilePOS5
/// bill (FOT_Reciepts.Edr_Seq), and «دمج الإيصالات» sets that bill's <c>Closed</c> to True when it
/// moves the stock — so no button press is needed to know a cashier's receipts were merged.
///
/// Order matters: the bills' Closed flags are read first and Edari's stock (File13n.CurTot1) for
/// their materials after, then both land locally in one transaction. A merge that happens between
/// the two reads can only make the shown stock briefly lower (one cycle), never higher — the safe
/// side for a website that must not sell what is gone.
/// </summary>
public sealed class StockSettlementService(
    EdariConnectionFactory connections,
    EdariSettingsService settings,
    EdariSyncGate gate,
    PendingStockRepository pending,
    ILogger<StockSettlementService> logger)
{
    private static readonly SemaphoreSlim Single = new(1, 1);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<long, DateTime> RecentlySettled = new();
    private static readonly TimeSpan RereadWindow = TimeSpan.FromMinutes(3);
    private const int MaxPerPass = 4000;
    private const int NexusChunk = 200;

    private sealed record BillState(bool StagingFound, bool StagingSynced, long EdrSeq, bool BillFound, bool Closed);

    public async Task<PendingStockCheckResultDto> CheckAsync(CancellationToken ct, TimeSpan? waitForOther = null)
    {
        if (!await Single.WaitAsync(waitForOther ?? TimeSpan.Zero, ct))
            return new PendingStockCheckResultDto(false, "فحص آخر يعمل الآن", 0, 0, 0, 0);
        try
        {
            return await CheckCoreAsync(ct, waitForOther is not null);
        }
        finally
        {
            Single.Release();
        }
    }

    private async Task<PendingStockCheckResultDto> CheckCoreAsync(CancellationToken ct, bool manual)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
            return new PendingStockCheckResultDto(false, "تكامل الإداري معطّل", 0, 0, 0, 0);
        if (!EdariConnectionFactory.DataFolderExists(opts))
            return new PendingStockCheckResultDto(false, $"مجلد النسخة غير موجود: {opts.YearFolder}", 0, 0, 0, 0);

        await pending.ExpireOldAsync(ct);
        await pending.PruneHoldsAsync(ct);

        var candidates = await pending.GetSettlementCandidatesAsync(MaxPerPass, ct);
        if (candidates.Count == 0 && RecentlySettled.IsEmpty)
        {
            const string none = "لا توجد فواتير في الإداري بانتظار الدمج";
            await pending.MarkCheckAsync(none, ct);
            return new PendingStockCheckResultDto(true, none, 0, 0, 0, 0);
        }

        // Same lock as the Edari data pull: a pull that read a material before the merge must not
        // write it back after this pass stored the post-merge stock.
        if (!await gate.WaitAsync(manual ? TimeSpan.FromSeconds(90) : TimeSpan.FromSeconds(5), ct))
            return new PendingStockCheckResultDto(false, "جلب بيانات الإداري يعمل الآن — أعد المحاولة بعد قليل", 0, 0, 0, 0);
        try
        {
            await using var nx = await connections.CreateOpenConnectionAsync(ct);
            var states = await ReadBillStatesAsync(nx, candidates.Select(c => c.Id).ToList(), ct);

            var settleAuto = new List<long>();
            var settleMissing = new List<long>();
            var verifiedClosed = new List<long>();
            var verifiedOpen = new List<long>();
            var stillOpen = 0;

            foreach (var (id, verify) in candidates)
            {
                states.TryGetValue(id, out var s);
                var known = s is { StagingFound: true, StagingSynced: true, EdrSeq: > 0 };
                if (verify)
                {
                    // Installed mid-day: only a bill that is provably still open goes back to pending.
                    if (known && s!.BillFound && !s.Closed) verifiedOpen.Add(id);
                    else verifiedClosed.Add(id);
                    continue;
                }

                if (!known)
                {
                    stillOpen++; // staging not visible (being re-posted) — wait; the age limit is the backstop
                    continue;
                }
                if (!s!.BillFound) settleMissing.Add(id);
                else if (s.Closed) settleAuto.Add(id);
                else stillOpen++;
            }

            // Post-merge stock, read only after the Closed flags above. Materials settled in the last
            // few minutes are read again on every pass: a merge still writing File13n when its bills
            // already show Closed would otherwise leave the pre-merge stock here until the next full pull.
            var now = DateTime.UtcNow;
            foreach (var old in RecentlySettled.Where(kv => kv.Value < now).Select(kv => kv.Key).ToList())
                RecentlySettled.TryRemove(old, out _);
            var seqs = new HashSet<long>(RecentlySettled.Keys);
            if (settleAuto.Count > 0)
            {
                foreach (var seq in await pending.GetArticleSeqsAsync(settleAuto, ct))
                {
                    seqs.Add(seq);
                    RecentlySettled[seq] = now + RereadWindow;
                }
            }
            var stock = seqs.Count > 0 ? await ReadEdariStockAsync(nx, seqs.ToList(), ct) : new Dictionary<long, double>();

            var applied = await pending.ApplySettlementAsync(settleAuto, "auto", verifiedClosed, verifiedOpen, stock, ct);
            if (settleMissing.Count > 0)
            {
                logger.LogWarning(
                    "Pending stock: {Count} receipt bill(s) no longer exist in Edari (deleted, not merged) — stopped subtracting them: {Ids}",
                    settleMissing.Count, string.Join(",", settleMissing.Take(20)));
                await pending.ApplySettlementAsync(settleMissing, "missing", [], [], new Dictionary<long, double>(), ct);
            }

            stillOpen += verifiedOpen.Count;
            var settled = applied.Settled + settleMissing.Count;
            var msg = settled > 0
                ? $"دُمجت {settled:N0} فاتورة في الإداري — بقيت {stillOpen:N0} بانتظار الدمج"
                : stillOpen > 0
                    ? $"{stillOpen:N0} فاتورة في الإداري بانتظار الدمج"
                    : "لا توجد فواتير في الإداري بانتظار الدمج";
            if (verifiedOpen.Count + verifiedClosed.Count > 0)
                logger.LogInformation("Pending stock baseline: {Open} receipt(s) still open in Edari, {Closed} already merged",
                    verifiedOpen.Count, verifiedClosed.Count);
            if (settled > 0)
                logger.LogInformation("Pending stock: {Message} (stock refreshed for {Stock} product(s))", msg, applied.StockChanged);

            await pending.MarkCheckAsync(msg, ct);
            return new PendingStockCheckResultDto(true, msg, candidates.Count, settled, stillOpen,
                applied.StockChanged + applied.PendingChanged);
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task<Dictionary<long, BillState>> ReadBillStatesAsync(
        DbConnection nx, IReadOnlyList<long> receiptIds, CancellationToken ct)
    {
        var result = new Dictionary<long, BillState>();
        foreach (var chunk in receiptIds.Chunk(NexusChunk))
        {
            var stagingIds = string.Join(",", chunk.Select(id => EdariSql.Long(EdariReceiptMapper.MapStagingReceiptId(id))));
            await using var cmd = nx.CreateEdariCommand();
            cmd.CommandText = $"""
                SELECT s.Reciept_Id, s.Edr_Synced, s.Edr_Seq, p.Seq, p.Closed
                FROM FOT_Reciepts s
                LEFT OUTER JOIN FilePOS5 p ON p.Seq = s.Edr_Seq
                WHERE s.Reciept_Id IN ({stagingIds})
                """;
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct))
            {
                var stagingId = Convert.ToInt64(rd.GetValue(0));
                var receiptId = stagingId - EdariReceiptMapper.MapStagingReceiptId(0);
                var synced = !rd.IsDBNull(1) && Convert.ToBoolean(rd.GetValue(1));
                var edrSeq = rd.IsDBNull(2) ? 0L : Convert.ToInt64(rd.GetValue(2));
                var billFound = !rd.IsDBNull(3);
                var closed = !rd.IsDBNull(4) && Convert.ToBoolean(rd.GetValue(4));
                result[receiptId] = new BillState(true, synced, edrSeq, billFound, closed);
            }
        }
        return result;
    }

    private static async Task<Dictionary<long, double>> ReadEdariStockAsync(
        DbConnection nx, IReadOnlyList<long> seqs, CancellationToken ct)
    {
        var result = new Dictionary<long, double>();
        foreach (var chunk in seqs.Chunk(NexusChunk))
        {
            await using var cmd = nx.CreateEdariCommand();
            cmd.CommandText = $"SELECT Seq, CurTot1 FROM File13n WHERE Seq IN ({string.Join(",", chunk.Select(EdariSql.Long))})";
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct))
            {
                var seq = Convert.ToInt64(rd.GetValue(0));
                result[seq] = rd.IsDBNull(1) ? 0d : Convert.ToDouble(rd.GetValue(1));
            }
        }
        return result;
    }
}
