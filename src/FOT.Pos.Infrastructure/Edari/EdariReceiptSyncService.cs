using System.Data.Common;
using FOT.Pos.Infrastructure.Repositories;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Edari;

public sealed class EdariReceiptSyncService(
    EdariConnectionFactory connections,
    EdariSettingsService settings,
    EdariSyncRepository syncRepo,
    EdariNexusClient nexus,
    Repositories.PosCashBoxSettingsRepository cashBoxes)
{
    public async Task<EdariSyncRunResult> SyncBatchAsync(int batchSize, CancellationToken ct)
    {
        var opts = await settings.GetEffectiveAsync(ct);
        if (!opts.Enabled)
            return new EdariSyncRunResult(false, "تكامل الإداري معطّل", 0, 0, 0, DateTime.UtcNow);

        if (!EdariConnectionFactory.DataFolderExists(opts))
            return new EdariSyncRunResult(false, $"مجلد النسخة غير موجود: {opts.YearFolder}", 0, 0, 0, DateTime.UtcNow);

        // Throws EdariCircuitOpenException fast while the breaker protects a down Edari server.
        await using var nx = await connections.CreateOpenConnectionAsync(ct);

        // Before anything else, so a number legacy claimed after our last commit is released on this cycle
        // even when there is nothing new to sync.
        await HealBillNumberClashesAsync(nx, ct);

        var receipts = await syncRepo.GetReceiptsForSyncAsync(batchSize, ct);
        if (receipts.Count == 0)
            return new EdariSyncRunResult(true, "لا توجد فواتير بانتظار المزامنة", 0, 0, 0, DateTime.UtcNow);

        var synced = 0;
        var failed = 0;
        var deadLettered = 0;

        // Gift receipts post as output invoices against this account (settings-configurable).
        var routing = await cashBoxes.GetAsync(ct);

        var branchProblems = new Dictionary<int, string>();
        foreach (var branch in receipts.Select(r => r.Branch).Where(b => b > 0).Distinct())
        {
            await nexus.EnsureBranchPostingAccountsAsync(branch, ct);
            var problem = await nexus.DescribeBranchPostingProblemAsync(branch, ct);
            if (problem is not null)
                branchProblems[branch] = problem;

            // Clear anything a previous crash left behind before the merge can pick it up.
            await SweepOrphanBillsAsync(nx, branch, ct);
        }

        foreach (var receipt in receipts)
        {
            try
            {
                if (branchProblems.TryGetValue(receipt.Branch, out var branchProblem))
                    throw new InvalidOperationException(branchProblem);

                var edrNum = await SyncOneReceiptAsync(nx, receipt, routing.EdariGiftAccount, routing.EdariQiAccount, ct);
                await syncRepo.MarkReceiptSyncedAsync(receipt.Id, edrNum, ct);
                await syncRepo.LogAttemptAsync(receipt.Id, "success", edrNum, null, "receipt", null, ct);
                synced++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failed++;
                var reason = ExtractEdariError(ex);
                // Structural failures (branch/accounting problems, missing article, totals mismatch)
                // are InvalidOperationException by contract — retrying them changes nothing.
                var permanent = ex is InvalidOperationException;
                await syncRepo.RecordSyncFailureAsync(receipt.Id, reason, permanent, ct);
                if (permanent) deadLettered++;
                await syncRepo.LogAttemptAsync(
                    receipt.Id, "failed", null, reason, "receipt",
                    permanent ? "dead-letter: فشل بنيوي" : "سيعاد تلقائياً بعد مهلة", ct);
            }
        }

        if (synced > 0)
        {
            await HealBillNumberClashesAsync(nx, ct);
            await syncRepo.UpdateLastReceiptSyncAsync(ct);
        }

        var ok = failed == 0;
        var deadNote = deadLettered > 0 ? $" — {deadLettered} متوقفة نهائياً تحتاج تدخلاً" : "";
        var msg = synced > 0
            ? $"تمت مزامنة {synced} فاتورة إلى الإداري (بانتظار دمج الإيصالات)" + (failed > 0 ? $" — فشل {failed}{deadNote}" : "")
            : $"فشلت مزامنة {failed} فاتورة{deadNote}";
        return new EdariSyncRunResult(ok, msg, synced, failed, 0, DateTime.UtcNow, deadLettered);
    }

    public async Task<EdariSyncRunResult> SyncAllAsync(int batchSize, CancellationToken ct)
    {
        var totalSynced = 0;
        var totalFailed = 0;
        const int maxBatches = 500;

        for (var i = 0; i < maxBatches; i++)
        {
            var batch = await SyncBatchAsync(batchSize, ct);
            totalSynced += batch.ReceiptsSynced;
            totalFailed += batch.ReceiptsFailed;

            if (!batch.Ok && batch.ReceiptsSynced == 0 && batch.ReceiptsFailed == 0)
                return batch;

            if (batch.ReceiptsSynced == 0)
                break;
        }

        if (totalSynced == 0 && totalFailed == 0)
            return new EdariSyncRunResult(true, "لا توجد فواتير بانتظار الترحيل", 0, 0, 0, DateTime.UtcNow);

        var ok = totalFailed == 0;
        var msg = totalSynced > 0
            ? $"تم ترحيل {totalSynced:N0} فاتورة — نفّذ «دمج الإيصالات» في Edari لترحيلها إلى الصناديق"
            + (totalFailed > 0 ? $" — فشل {totalFailed:N0}" : "")
            : $"فشل ترحيل {totalFailed:N0} فاتورة";
        return new EdariSyncRunResult(ok, msg, totalSynced, totalFailed, 0, DateTime.UtcNow);
    }

    public async Task<int> ResetReceiptsForResyncAsync(DateTime? from, DateTime? to, long? sectionId, CancellationToken ct)
    {
        var ids = await syncRepo.GetSyncedReceiptIdsAsync(from, to, sectionId, ct);
        if (ids.Count == 0) return 0;

        await using var nx = await connections.CreateOpenConnectionAsync(ct);
        foreach (var id in ids)
            await ResetEdariStagingAsync(nx, id, ct);

        return await syncRepo.ResetReceiptsSyncStateAsync(ids, ct);
    }

    /// <summary>
    /// Account written on the Edari bill. Gifts post as output invoices against the configured
    /// gifts account (default 3133), card-paid receipts against the configured card/QI settlement
    /// account, credit receipts against their customer account, and cash receipts against the cash
    /// box the cashier actually selected.
    ///
    /// Cash used to go out as Acc=0, which makes «دمج الإيصالات» post to <c>FileBrch.CashAcc</c> —
    /// a single account per branch. So a cashier working two boxes had both invoices land in the
    /// section's first box. Naming the box on the bill is the same mechanism the card and gift
    /// accounts already use, and for the default box it resolves to the very account the branch
    /// was posting to before.
    /// </summary>
    private static long EffectiveEdariAccount(ReceiptForEdariSync receipt, int giftAccount, int qiAccount)
    {
        if (receipt.Kind == 2)
        {
            if (giftAccount <= 0)
                throw new InvalidOperationException(
                    $"فاتورة #{receipt.Number}: حساب الهدايا للأداري غير مضبوط — اضبطه من الإعدادات ← الصناديق والأداري ثم أعد الترحيل");
            return giftAccount;
        }

        if (receipt.IsCardPayment)
        {
            if (qiAccount <= 0)
                throw new InvalidOperationException(
                    $"فاتورة #{receipt.Number}: حساب البطاقات للأداري غير مضبوط — اضبطه من الإعدادات ← الصناديق والأداري ثم أعد الترحيل");
            return qiAccount;
        }

        // Credit sale: the customer owes the money, no cash box is involved.
        if (receipt.Account > 0)
            return EdariReceiptMapper.MapEdariAccount(receipt.Account);

        // Cash sale: post into the selected box; Acc=0 keeps the old branch-account behaviour for
        // receipts saved before cash boxes were linked to the section.
        return receipt.MasterAccount > 0 ? receipt.MasterAccount : 0;
    }

    private static async Task<long> SyncOneReceiptAsync(
        DbConnection nx, ReceiptForEdariSync receipt, int giftAccount, int qiAccount, CancellationToken ct)
    {
        if (receipt.Branch <= 0)
            throw new InvalidOperationException(
                $"فاتورة #{receipt.Number}: قسم الكاشير غير مربوط بفرع Edari — اربط القسم بفرع من «الأقسام» ثم أعد الترحيل");

        var edariKind = EdariReceiptMapper.MapEdariBillKind(receipt.Kind, receipt.Account);
        var edariCasher = EdariReceiptMapper.MapEdariCasher(receipt.MasterAccount);
        var edariAcc = EffectiveEdariAccount(receipt, giftAccount, qiAccount);

        var state = await GetStagingStateAsync(nx, receipt, edariKind, edariCasher, edariAcc, ct);
        if (state.Synced && state.EdrSeq.HasValue && state.BillOpen)
            return await GetBillNumBySeqAsync(nx, state.EdrSeq.Value, ct);

        if (state.Synced && state.EdrSeq.HasValue && !state.BillOpen)
            await ResetEdariStagingAsync(nx, receipt.Id, ct);

        await UpsertStagingAsync(nx, receipt, edariAcc, ct);
        return await GenerateEdariBillAsync(nx, receipt, edariAcc, ct);
    }

    private sealed record StagingState(bool Exists, bool Synced, long? EdrSeq, bool BillOpen);

    private static async Task<StagingState> GetStagingStateAsync(
        DbConnection nx, ReceiptForEdariSync receipt, int edariKind, long edariCasher, long edariAcc, CancellationToken ct)
    {
        await using var cmd = nx.CreateEdariCommand();
        cmd.CommandText = $"""
            SELECT Edr_Synced, Edr_Seq
            FROM FOT_Reciepts
            WHERE Reciept_Id = {StagingId(receipt.Id)}
            """;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
            return new StagingState(false, false, null, false);

        var synced = !reader.IsDBNull(0) && Convert.ToBoolean(reader.GetValue(0));
        long? seq = reader.IsDBNull(1) ? null : Convert.ToInt64(reader.GetValue(1));
        await reader.CloseAsync();

        if (!synced || seq is null or <= 0)
            return new StagingState(true, synced, seq, false);

        var billOpen = await IsOpenBillValidAsync(nx, seq.Value, receipt.Branch, edariKind, edariCasher, edariAcc, ct);
        return new StagingState(true, synced, seq, billOpen);
    }

    private static async Task<bool> IsOpenBillValidAsync(
        DbConnection nx, long billSeq, int branch, int edariKind, long edariCasher, long edariAcc, CancellationToken ct)
    {
        await using var cmd = nx.CreateEdariCommand();
        cmd.CommandText = $"""
            SELECT Closed, Branch, Kind, Casher, Acc
            FROM FilePOS5
            WHERE Seq = {EdariSql.Long(billSeq)}
            """;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return false;

        var closed = !reader.IsDBNull(0) && Convert.ToBoolean(reader.GetValue(0));
        var billBranch = reader.IsDBNull(1) ? 0 : Convert.ToInt32(reader.GetValue(1));
        var billKind = reader.IsDBNull(2) ? 0 : Convert.ToInt32(reader.GetValue(2));
        var billCasher = reader.IsDBNull(3) ? 0L : Convert.ToInt64(reader.GetValue(3));
        var billAcc = reader.IsDBNull(4) ? 0L : Convert.ToInt64(reader.GetValue(4));

        return !closed
               && billBranch == branch
               && billKind == edariKind
               && billCasher == edariCasher
               && billAcc == edariAcc;
    }

    private static string StagingId(long posReceiptId) =>
        EdariSql.Long(EdariReceiptMapper.MapStagingReceiptId(posReceiptId));

    private static Task ResetEdariStagingAsync(DbConnection nx, long receiptId, CancellationToken ct) =>
        DeleteStagingAsync(nx, null, receiptId, ct);

    private static async Task DeleteStagingAsync(DbConnection nx, DbTransaction? tx, long receiptId, CancellationToken ct)
    {
        await using (var delItems = nx.CreateEdariCommand())
        {
            if (tx is not null) delItems.Transaction = tx;
            delItems.CommandText = $"""
                DELETE FROM FOT_Reciept_Items WHERE Reciept_Id = {StagingId(receiptId)}
                """;
            await delItems.ExecuteNonQueryAsync(ct);
        }

        await using var delHdr = nx.CreateEdariCommand();
        if (tx is not null) delHdr.Transaction = tx;
        delHdr.CommandText = $"""
            DELETE FROM FOT_Reciepts WHERE Reciept_Id = {StagingId(receiptId)}
            """;
        await delHdr.ExecuteNonQueryAsync(ct);
    }

    private static string ExtractEdariError(Exception ex)
    {
        var msg = ex.Message;
        const string marker = "Error in statement:";
        var i = msg.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (i >= 0)
        {
            var slice = msg[i..];
            var end = slice.IndexOf("<[--!", StringComparison.Ordinal);
            return end > 0 ? slice[..end].Trim() : slice.Trim();
        }

        i = msg.IndexOf("Field validation", StringComparison.OrdinalIgnoreCase);
        if (i >= 0)
        {
            var slice = msg[i..];
            var end = slice.IndexOf("<[--!", StringComparison.Ordinal);
            return end > 0 ? slice[..end].Trim() : slice.Trim();
        }

        return msg.Length > 400 ? msg[..400] : msg;
    }

    private static async Task<int> ResolveEdariCashierIdAsync(DbConnection nx, int edariBranch, CancellationToken ct) =>
        await ResolveEdariStagingIntAsync(nx, edariBranch, "cashier_id", EdariReceiptMapper.MapEdariCashierId(edariBranch), ct);

    private static async Task<int> ResolveEdariStagingIntAsync(
        DbConnection nx, int edariBranch, string column, int fallback, CancellationToken ct)
    {
        await using var cmd = nx.CreateEdariCommand();
        cmd.CommandText = $"""
            SELECT TOP 1 {column} FROM FOT_Reciepts
            WHERE Branch = {EdariSql.Int(edariBranch)} AND {column} IS NOT NULL AND {column} > 0
            ORDER BY Reciept_Id DESC
            """;
        var result = await cmd.ExecuteScalarAsync(ct);
        if (result is not null && result != DBNull.Value)
            return Convert.ToInt32(result);
        return fallback;
    }

    private static async Task<int> AllocateEdariReceiptNumberAsync(
        DbConnection nx, DbTransaction? tx, int edariPosId, CancellationToken ct)
    {
        await using var cmd = nx.CreateEdariCommand();
        if (tx is not null) cmd.Transaction = tx;
        cmd.CommandText = $"SELECT MAX(Number) FROM FOT_Reciepts WHERE pos_id = {EdariSql.Int(edariPosId)}";
        var current = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt32(current ?? 0) + 1;
    }

    private static async Task UpsertStagingAsync(DbConnection nx, ReceiptForEdariSync receipt, long edariAcc, CancellationToken ct)
    {
        // Never inherited from existing rows: legacy FOT POS rows for the same branch carry its own
        // pos_id, and reusing it puts both systems on one Number sequence (see MapEdariPosId).
        var edariPosId = EdariReceiptMapper.MapEdariPosId(receipt.Branch);
        var edariCashierId = await ResolveEdariCashierIdAsync(nx, receipt.Branch, ct);
        var edariBillKind = EdariReceiptMapper.MapEdariBillKind(receipt.Kind, receipt.Account);
        var stagingKind = EdariReceiptMapper.MapEdariStagingKind(edariBillKind);
        var syncedDate = DateTime.Now;
        await using var tx = nx.BeginTransaction();
        try
        {
            await DeleteStagingAsync(nx, tx, receipt.Id, ct);

            var edariNumber = await AllocateEdariReceiptNumberAsync(nx, tx, edariPosId, ct);
            await using (var hdr = nx.CreateEdariCommand())
            {
                hdr.Transaction = tx;
                hdr.CommandText = $"""
                    INSERT INTO FOT_Reciepts (
                        Reciept_Id, Number, Creation_Date, Total_Amount, Items_Discount, Offers_Discount,
                        User_Discount, Payment, Cash_Back, Account, Salesman, Branch, Kind,
                        pos_id, cashier_id, virtual_date, synced_date, Edr_Synced
                    ) VALUES (
                        {StagingId(receipt.Id)}, {EdariSql.Int(edariNumber)}, {EdariSql.DateTime(receipt.CreationDate)},
                        {EdariSql.Decimal(Math.Abs(receipt.TotalAmount))}, {EdariSql.Decimal(receipt.ItemsDiscount)},
                        {EdariSql.Decimal(receipt.OffersDiscount)}, {EdariSql.Decimal(receipt.UserDiscount)},
                        0, {EdariSql.Decimal(receipt.CashBack)},
                        {EdariSql.Long(edariAcc)},
                        0,
                        {EdariSql.Int(receipt.Branch)}, {EdariSql.Int(stagingKind)},
                        {EdariSql.Int(edariPosId)}, {EdariSql.Int(edariCashierId)},
                        {EdariSql.VirtualDate(receipt.CreationDate)}, {EdariSql.DateTime(syncedDate)}, 0
                    )
                    """;
                await hdr.ExecuteNonQueryAsync(ct);
            }

            foreach (var item in receipt.Items)
            {
                await using var line = nx.CreateEdariCommand();
                line.Transaction = tx;
                line.CommandText = $"""
                    INSERT INTO FOT_Reciept_Items (
                        Reciept_Id, Article_Id, Quantity, Price, Original_Price, Discount, Kind
                    ) VALUES (
                        {StagingId(receipt.Id)}, {EdariSql.Long(item.ArticleSeq)},
                        {EdariSql.Decimal(EdariReceiptMapper.MapEdariQuantity(item.Quantity))}, {EdariSql.Decimal(item.Price)},
                        {EdariSql.Decimal(item.OriginalPrice)}, {EdariSql.Decimal(item.Discount)},
                        {EdariSql.Int(stagingKind)}
                    )
                    """;
                await line.ExecuteNonQueryAsync(ct);
            }

            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    private static async Task<long> GenerateEdariBillAsync(
        DbConnection nx, ReceiptForEdariSync receipt, long edariAcc, CancellationToken ct)
    {
        var edariKind = EdariReceiptMapper.MapEdariBillKind(receipt.Kind, receipt.Account);
        var edariSaleMan = EdariReceiptMapper.MapEdariSalesman(receipt.Salesman);
        var edariCasher = EdariReceiptMapper.MapEdariCasher(receipt.MasterAccount);

        var createdBillSeq = 0L;
        await using var tx = nx.BeginTransaction();
        try
        {
            var (billNum, billSeq, _) = await ResolveOpenBillAsync(
                nx, tx, receipt, edariKind, edariAcc, edariSaleMan, edariCasher, ct);
            createdBillSeq = billSeq;

            await InsertBillLinesAsync(nx, tx, receipt, billSeq, edariKind, ct);

            await using (var upd = nx.CreateEdariCommand())
            {
                upd.Transaction = tx;
                upd.CommandText = $"""
                    UPDATE FOT_Reciepts SET Edr_Synced = 1, Edr_Seq = {EdariSql.Long(billSeq)}
                    WHERE Reciept_Id = {StagingId(receipt.Id)}
                    """;
                await upd.ExecuteNonQueryAsync(ct);
            }

            await tx.CommitAsync(ct);
            return billNum;
        }
        catch
        {
            try { await tx.RollbackAsync(ct); } catch { /* the bill is removed below anyway */ }

            // A NexusDB rollback has been observed to leave the inserted FilePOS5 bill and its
            // FilePOS4 lines in place. Such a bill belongs to no staging row, so «دمج الإيصالات»
            // merges it as an extra sale and the cash box ends up above the POS total. The
            // half-written bill is therefore removed explicitly.
            if (createdBillSeq > 0)
                await DeleteBillAsync(nx, createdBillSeq, ct);
            throw;
        }
    }

    /// <summary>Removes a staged bill and its lines — used to clean up after a failed push.</summary>
    private static async Task DeleteBillAsync(DbConnection nx, long billSeq, CancellationToken ct)
    {
        try
        {
            await using (var lines = nx.CreateEdariCommand())
            {
                lines.CommandText = $"DELETE FROM FilePOS4 WHERE NBillNum = {EdariSql.Long(billSeq)}";
                await lines.ExecuteNonQueryAsync(ct);
            }
            await using var hdr = nx.CreateEdariCommand();
            hdr.CommandText = $"DELETE FROM FilePOS5 WHERE Seq = {EdariSql.Long(billSeq)}";
            await hdr.ExecuteNonQueryAsync(ct);
        }
        catch
        {
            // The original failure is the one worth reporting; a stuck cleanup is caught by
            // the orphan sweep on the next push.
        }
    }

    /// <summary>
    /// Deletes staged bills that no receipt owns and that «دمج الإيصالات» has not consumed yet.
    /// They can only come from a push that died between writing the bill and marking the receipt,
    /// and if merged they would double the day's sales.
    /// </summary>
    private static async Task<int> SweepOrphanBillsAsync(DbConnection nx, int branch, CancellationToken ct)
    {
        if (branch <= 0) return 0;
        try
        {
            await using var cmd = nx.CreateEdariCommand();
            cmd.CommandText = $"""
                SELECT p.Seq FROM FilePOS5 p
                WHERE p.Branch = {EdariSql.Int(branch)} AND p.Closed = False
                  AND NOT EXISTS (SELECT 1 FROM FOT_Reciepts s WHERE s.Edr_Seq = p.Seq)
                """;
            var orphans = new List<long>();
            await using (var rd = await cmd.ExecuteReaderAsync(ct))
            {
                while (await rd.ReadAsync(ct))
                    orphans.Add(Convert.ToInt64(rd.GetValue(0)));
            }
            foreach (var seq in orphans)
                await DeleteBillAsync(nx, seq, ct);
            return orphans.Count;
        }
        catch
        {
            return 0;
        }
    }

    private static async Task<(long BillNum, long BillSeq, bool IsNew)> ResolveOpenBillAsync(
        DbConnection nx, DbTransaction tx, ReceiptForEdariSync receipt,
        int edariKind, long edariAcc, long edariSaleMan, long edariCasher, CancellationToken ct)
    {
        _ = edariAcc;
        _ = edariSaleMan;
        _ = edariCasher;

        var newBillNum = await AllocateEdariBillNumAsync(nx, tx, edariKind, ct);
        await using (var hdr = nx.CreateEdariCommand())
        {
            hdr.Transaction = tx;
            hdr.CommandText = $"""
                INSERT INTO FilePOS5 (
                    Num, "Date", SaleMan, Acc, Casher, Tot, Dscnt, PayMent1, Kind, Branch, Closed,
                    Delivered, PayCurr1, Equ1, WorkDate
                ) VALUES (
                    {EdariSql.Long(newBillNum)}, {EdariSql.VirtualDate(receipt.CreationDate)},
                    {EdariSql.Long(edariSaleMan)}, {EdariSql.Long(edariAcc)},
                    {EdariSql.Long(edariCasher)}, {EdariSql.Decimal(Math.Abs(receipt.TotalAmount))},
                    {EdariSql.Decimal(EdariReceiptMapper.MapEdariBillDiscount(receipt.UserDiscount))},
                    0, {EdariSql.Int(edariKind)},
                    {EdariSql.Int(receipt.Branch)}, 0,
                    1, 1, 1, {EdariSql.DateTime(receipt.CreationDate)}
                )
                """;
            await hdr.ExecuteNonQueryAsync(ct);
        }

        long newBillSeq;
        await using (var seqCmd = nx.CreateEdariCommand())
        {
            seqCmd.Transaction = tx;
            seqCmd.CommandText = $"""
                SELECT MAX(Seq) FROM FilePOS5
                WHERE Num = {EdariSql.Long(newBillNum)}
                  AND Kind = {EdariSql.Int(edariKind)}
                  AND Branch = {EdariSql.Int(receipt.Branch)}
                """;
            newBillSeq = Convert.ToInt64(await seqCmd.ExecuteScalarAsync(ct) ?? 0L);
        }

        if (newBillSeq <= 0)
            throw new InvalidOperationException("تعذر إنشاء فاتورة FilePOS5 في Edari");

        return (newBillNum, newBillSeq, true);
    }

    private static async Task InsertBillLinesAsync(
        DbConnection nx, DbTransaction tx, ReceiptForEdariSync receipt, long billSeq, int edariKind, CancellationToken ct)
    {
        if (receipt.Items.Count == 0)
            throw new InvalidOperationException(
                $"فاتورة #{receipt.Number}: لا تحتوي أصنافاً — الدمج سينشئ فاتورة بمبلغ صفر");

        var linesTotal = 0m;
        foreach (var item in receipt.Items)
        {
            var qty = EdariReceiptMapper.MapEdariQuantity(item.Quantity);
            var lineTotal = EdariReceiptMapper.MapEdariLineTotal(item.Quantity, item.Price);
            await using var line = nx.CreateEdariCommand();
            line.Transaction = tx;
            // Names are copied inside the engine (INSERT..SELECT) because reading Edari's legacy
            // Arabic text into .NET and writing it back replaces every Arabic letter with '?'.
            // Mat (File13n.Seq) is what «دمج الإيصالات» reads to build the sales invoice lines —
            // without it the merged invoice is created with a zero total.
            line.CommandText = $"""
                INSERT INTO FilePOS4 (
                    NBillNum, MatNum, MatBarNum, MatName, Quant, Price, Total, Kind,
                    Mat, ExpSeq, SerSeq
                )
                SELECT {EdariSql.Long(billSeq)}, f.Num, f.Barcode, f.Name1,
                       {EdariSql.Decimal(qty)}, {EdariSql.Decimal(item.Price)},
                       {EdariSql.Decimal(lineTotal)},
                       {EdariSql.Int(edariKind)},
                       f.Seq, 0, 0
                FROM File13n f WHERE f.Seq = {EdariSql.Long(item.ArticleSeq)}
                """;

            // INSERT..SELECT silently writes nothing when the article is missing from File13n,
            // which used to surface only after the merge as an invoice with a zero total.
            if (await line.ExecuteNonQueryAsync(ct) == 0)
            {
                var label = string.IsNullOrWhiteSpace(item.Barcode)
                    ? $"Seq {item.ArticleSeq}"
                    : $"باركود {item.Barcode}";
                throw new InvalidOperationException(
                    $"فاتورة #{receipt.Number}: الصنف ({label}) غير موجود في مواد الإداري — نفّذ «مزامنة المواد» ثم أعد الترحيل");
            }

            linesTotal += lineTotal;
        }

        await StampBillLineDatesAsync(nx, tx, billSeq, ct);

        // The lines carry the amount before the invoice discount, exactly like legacy FOT POS:
        // FilePOS5.Dscnt holds that discount and «دمج الإيصالات» subtracts it. Comparing the
        // lines against the net total instead would reject every discounted receipt.
        var expectedLines = EdariReceiptMapper.ExpectedBillLinesTotal(
            receipt.TotalAmount, receipt.UserDiscount);
        if (Math.Abs(linesTotal - expectedLines) > 0.01m)
            throw new InvalidOperationException(
                $"فاتورة #{receipt.Number}: مجموع الأصناف {linesTotal:N2} لا يساوي إجمالي الفاتورة {receipt.TotalAmount:N2} " +
                $"+ خصم الفاتورة {receipt.UserDiscount:N2} — الدمج سيسجّل مبلغاً خاطئاً في الصندوق");
    }

    /// <summary>
    /// NexusDB rejects a date literal both inside INSERT..SELECT and inside UPDATE, so FilePOS4."Date"
    /// is copied from the bill header instead of being written with the line.
    /// </summary>
    private static async Task StampBillLineDatesAsync(
        DbConnection nx, DbTransaction tx, long billSeq, CancellationToken ct)
    {
        await using var cmd = nx.CreateEdariCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"""
            UPDATE FilePOS4
            SET "Date" = (SELECT "Date" FROM FilePOS5 WHERE Seq = {EdariSql.Long(billSeq)})
            WHERE NBillNum = {EdariSql.Long(billSeq)}
            """;
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Continues Edari's running bill number exactly as legacy FOT POS does — one sequence per Kind across
    /// every branch. Both systems therefore pick the same number whenever they allocate at the same moment,
    /// and the unique index permits it because it also covers Branch. HealBillNumberClashesAsync cleans that
    /// up afterwards; an isolated range is not an option because legacy follows whatever maximum it finds.
    /// </summary>
    private static async Task<long> AllocateEdariBillNumAsync(
        DbConnection nx, DbTransaction? tx, int edariKind, CancellationToken ct)
    {
        await using var cmd = nx.CreateEdariCommand();
        if (tx is not null) cmd.Transaction = tx;
        cmd.CommandText = $"SELECT MAX(Num) FROM FilePOS5 WHERE Kind = {EdariSql.Int(edariKind)}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct) ?? 0L) + 1;
    }

    private static async Task<long> GetBillNumBySeqAsync(DbConnection nx, long billSeq, CancellationToken ct)
    {
        await using var cmd = nx.CreateEdariCommand();
        cmd.CommandText = $"SELECT Num FROM FilePOS5 WHERE Seq = {EdariSql.Long(billSeq)}";
        var result = await cmd.ExecuteScalarAsync(ct);
        return Convert.ToInt64(result ?? 0L);
    }

    /// <summary>How many of our most recent bills to re-examine for a clash on every sync cycle.</summary>
    private const int BillClashScanWindow = 200;

    private sealed record OwnBill(long PosReceiptId, long Seq, long Num, int Kind);

    /// <summary>
    /// Moves our bill off any number another branch's bill also carries. Legacy FOT POS never re-checks the
    /// number it issued, so ours is the side that yields and the receipt's edr_num follows it. This runs on
    /// every cycle rather than at insert time because legacy usually claims the number a moment after our own
    /// transaction has already committed, which no check inside that transaction could see.
    /// </summary>
    private async Task HealBillNumberClashesAsync(DbConnection nx, CancellationToken ct)
    {
        var ours = await GetRecentOwnBillsAsync(nx, ct);
        if (ours.Count == 0) return;

        var clashes = await GetClashingBillKeysAsync(nx, ours, ct);
        if (clashes.Count == 0) return;

        foreach (var bill in ours.Where(b => clashes.Contains((b.Num, b.Kind))))
        {
            var newNum = await AllocateEdariBillNumAsync(nx, null, bill.Kind, ct);

            await using (var upd = nx.CreateEdariCommand())
            {
                upd.CommandText = $"""
                    UPDATE FilePOS5 SET Num = {EdariSql.Long(newNum)}
                    WHERE Seq = {EdariSql.Long(bill.Seq)} AND Num = {EdariSql.Long(bill.Num)}
                    """;
                if (await upd.ExecuteNonQueryAsync(ct) == 0) continue;
            }

            await syncRepo.UpdateEdrNumAsync(bill.PosReceiptId, newNum, ct);
        }
    }

    private static async Task<List<OwnBill>> GetRecentOwnBillsAsync(DbConnection nx, CancellationToken ct)
    {
        var seqToReceipt = new Dictionary<long, long>();
        await using (var staging = nx.CreateEdariCommand())
        {
            staging.CommandText = $"""
                SELECT TOP {BillClashScanWindow} Reciept_Id, Edr_Seq
                FROM FOT_Reciepts
                WHERE Reciept_Id >= {EdariSql.Long(EdariReceiptMapper.StagingReceiptIdFloor)} AND Edr_Seq > 0
                ORDER BY Reciept_Id DESC
                """;
            await using var reader = await staging.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                seqToReceipt[reader.GetInt64(1)] =
                    EdariReceiptMapper.UnmapStagingReceiptId(reader.GetInt64(0));
        }

        if (seqToReceipt.Count == 0) return [];

        var bills = new List<OwnBill>();
        await using (var cmd = nx.CreateEdariCommand())
        {
            cmd.CommandText = $"SELECT Seq, Num, Kind FROM FilePOS5 WHERE Seq IN ({JoinLiterals(seqToReceipt.Keys)})";
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var seq = reader.GetInt64(0);
                if (seqToReceipt.TryGetValue(seq, out var posReceiptId))
                    bills.Add(new OwnBill(posReceiptId, seq, reader.GetInt64(1), reader.GetInt32(2)));
            }
        }

        return bills;
    }

    private static async Task<HashSet<(long Num, int Kind)>> GetClashingBillKeysAsync(
        DbConnection nx, List<OwnBill> ours, CancellationToken ct)
    {
        var clashes = new HashSet<(long, int)>();
        await using var cmd = nx.CreateEdariCommand();
        cmd.CommandText = $"""
            SELECT Num, Kind, COUNT(*) AS Held
            FROM FilePOS5
            WHERE Num IN ({JoinLiterals(ours.Select(b => b.Num).Distinct())})
            GROUP BY Num, Kind
            HAVING COUNT(*) > 1
            """;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            clashes.Add((reader.GetInt64(0), reader.GetInt32(1)));
        return clashes;
    }

    private static string JoinLiterals(IEnumerable<long> values) =>
        string.Join(", ", values.Select(EdariSql.Long));
}

public sealed record ReceiptForEdariSync(
    long Id,
    long Number,
    DateTime CreationDate,
    decimal TotalAmount,
    decimal ItemsDiscount,
    decimal OffersDiscount,
    decimal UserDiscount,
    decimal Payment,
    decimal CashBack,
    long Account,
    long MasterAccount,
    long Salesman,
    long CashierId,
    int Branch,
    int Warehouse,
    int Kind,
    bool IsCardPayment,
    IReadOnlyList<ReceiptItemForEdariSync> Items);

public sealed record ReceiptItemForEdariSync(
    long ArticleSeq,
    string? Barcode,
    decimal Quantity,
    decimal Price,
    decimal OriginalPrice,
    decimal Discount);
