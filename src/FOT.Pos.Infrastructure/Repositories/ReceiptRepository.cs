using System.Text.Json;
using System.Text.Json.Serialization;
using Dapper;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;
using Microsoft.Data.SqlClient;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class ReceiptRepository(
    ISqlConnectionFactory db,
    ReceiptSchemaService schema,
    ReceiptSideEffectsDispatcher sideEffects,
    ReceiptNumberAllocator receiptNumbers,
    SectionRepository sections,
    PosCashBoxSettingsRepository cashBoxSettings,
    DiscountQrRepository discountQr)
{
    private static bool IsMissingColumn(SqlException ex) =>
        ex.Number == 207 || ex.Message.Contains("Invalid column name", StringComparison.OrdinalIgnoreCase);

    private static bool IsDuplicateKey(SqlException ex) => ex.Number is 2627 or 2601;

    private static async Task SafeRollbackAsync(System.Data.Common.DbTransaction tx)
    {
        try { await tx.RollbackAsync(); }
        catch { /* already committed or doomed */ }
    }
    public async Task<PagedResult<ReceiptSummaryDto>> ListAsync(int page, int pageSize, string? search, CancellationToken ct)
    {
        var result = await SearchAsync(page, pageSize, search, null, null, null, null, null, null, null, null, null, ct);
        return new PagedResult<ReceiptSummaryDto>(result.Items, result.Total, result.Page, result.PageSize);
    }

    public async Task<ReceiptSearchResult> SearchAsync(
        int page, int pageSize, string? search,
        long? sectionId, long? posId, long? cashierId, int? kind, bool? syncedOnly, bool? unsyncedOnly,
        DateTime? from, DateTime? to, bool? holdOnly, CancellationToken ct)
    {
        await schema.EnsureLoadedAsync(ct);
        var where = holdOnly == true ? "WHERE r.is_pending = 1" : "WHERE r.is_pending = 0";
        var p = new DynamicParameters();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var printedSearch = schema.PrintedNumber
                ? " OR CAST(r.printed_number AS NVARCHAR(20)) LIKE @s"
                : "";
            where += $" AND (CAST(r.number AS NVARCHAR(20)) LIKE @s OR sm.name LIKE @s OR CAST(r.edr_num AS NVARCHAR(20)) LIKE @s OR c.username LIKE @s{printedSearch})";
            p.Add("s", $"%{search.Trim()}%");
        }
        if (sectionId.HasValue) { where += " AND sec.id = @sectionId"; p.Add("sectionId", sectionId); }
        if (posId.HasValue) { where += " AND r.point_of_sale_id = @posId"; p.Add("posId", posId); }
        if (cashierId.HasValue) { where += " AND r.cashier_id = @cashierId"; p.Add("cashierId", cashierId); }
        if (kind.HasValue) { where += " AND r.kind = @kind"; p.Add("kind", kind); }
        if (syncedOnly == true) where += " AND r.synced = 1";
        if (unsyncedOnly == true) where += " AND r.synced = 0";
        if (from.HasValue) { where += " AND r.creation_date >= @from"; p.Add("from", from.Value); }
        if (to.HasValue) { where += " AND r.creation_date < @toPlus"; p.Add("toPlus", to.Value.Date.AddDays(1)); }

        p.Add("offset", (page - 1) * pageSize);
        p.Add("pageSize", pageSize);

        var wasEditedExpr = schema.ReceiptEdits
            ? "CAST(CASE WHEN EXISTS (SELECT 1 FROM ext_receipt_edits e WHERE e.receipt_id = r.id) THEN 1 ELSE 0 END AS bit) AS WasEdited"
            : "CAST(0 AS bit) AS WasEdited";

        var select = $"""
            SELECT r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   CAST(r.payment AS DECIMAL(18,2)) AS Payment,
                   CAST(r.cash_back AS DECIMAL(18,2)) AS CashBack,
                   r.salesman AS SalesmanId,
                   COALESCE(sm.name, one.OnlyName) AS SalesmanName,
                   COALESCE(sellers.SellerCount, 0) AS SalesmanCount,
                   r.point_of_sale_id AS PosId, pos.name AS PosName,
                   CAST(r.synced AS bit) AS Synced, r.edr_num AS EdrNum,
                   COALESCE(ric.ItemCount, 0) AS ItemCount,
                   CAST(r.items_discount AS DECIMAL(18,2)) AS ItemsDiscount,
                   CAST(r.offers_discount AS DECIMAL(18,2)) AS OffersDiscount,
                   CAST(r.user_discount AS DECIMAL(18,2)) AS UserDiscount,
                   r.kind AS Kind, r.cashier_id AS CashierId, c.username AS CashierName,
                   CASE
                       WHEN cc.reciept_id IS NOT NULL THEN COALESCE(NULLIF(LTRIM(cc.card_type), ''), NULLIF(LTRIM(cc.cardHolderName), ''), N'ماستر كارد')
                       WHEN r.account > 0 THEN COALESCE(acc.Name1, acc.Num)
                       ELSE COALESCE(macc.Name1, macc.Num)
                   END AS AccountName,
                   sec.id AS SectionId, sec.name AS SectionName, r.sync_date AS SyncDate,
                   CAST(cc.amount AS DECIMAL(18,2)) AS CardAmount,
                   cc.cardHolderName AS CardName, cc.acquirer AS CardAcquirer,
                   cc.accNo AS CardAccNo, cc.rrn AS CardRrn, cc.terminalId AS CardTerminalId,
                   cc.auth_code AS CardAuthCode, cc.timestamp AS CardTransTime,
                   cc.card_type AS CardType, cc.ref_no AS CardRefNo,
                   NULLIF(r.master_account, 0) AS MasterAccount,
                   box.account_num AS CashBoxNum, box.account_name AS CashBoxName,
                   r.discount_qr_person_id AS DiscountQrPersonId,
                   COALESCE(r.discount_qr_person_name, dqp.name) AS DiscountQrPersonName,
                   {wasEditedExpr},
                   {(schema.PrintedNumber ? "r.printed_number AS PrintedNumber" : "CAST(NULL AS BIGINT) AS PrintedNumber")}
            FROM reciepts r
            LEFT JOIN salesmen sm ON sm.id = r.salesman
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            LEFT JOIN accounts acc ON acc.id = r.account
            LEFT JOIN accounts macc ON macc.id = r.master_account
            -- Cash box labels come from the Edari account mirror; the local accounts table is an
            -- empty stub, so joining it alone left the column blank.
            LEFT JOIN ext_edari_accounts box ON box.edari_seq = r.master_account
            LEFT JOIN ext_discount_qr_people dqp ON dqp.id = r.discount_qr_person_id
            -- A receipt split across salesmen carries no header salesman on purpose, so the list
            -- counts the distinct sellers on its lines and names the seller when there is only one.
            OUTER APPLY (
                SELECT COUNT(DISTINCT ri.salesman_id) AS SellerCount
                FROM reciept_items ri
                WHERE ri.reciept_id = r.id AND COALESCE(ri.salesman_id, 0) > 0
            ) sellers
            OUTER APPLY (
                SELECT TOP 1 COALESCE(NULLIF(LTRIM(RTRIM(ri.salesman_name)), ''), ls.name) AS OnlyName
                FROM reciept_items ri
                LEFT JOIN salesmen ls ON ls.id = ri.salesman_id
                WHERE ri.reciept_id = r.id AND COALESCE(ri.salesman_id, 0) > 0
            ) one
            LEFT JOIN (
                SELECT reciept_id, COUNT(*) AS ItemCount
                FROM reciept_items
                GROUP BY reciept_id
            ) ric ON ric.reciept_id = r.id
            OUTER APPLY (
                SELECT TOP 1 * FROM reciept_credit_card k
                WHERE k.reciept_id = r.id ORDER BY k.id DESC
            ) cc
            """;

        var sql = $"""
            {select}
            {where}
            ORDER BY r.id DESC
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            SELECT COUNT(*) FROM reciepts r
            LEFT JOIN salesmen sm ON sm.id = r.salesman
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            {where};
            SELECT COUNT(*) AS ReceiptCount,
                   CAST(COALESCE(SUM(r.total_amount + r.offers_discount + r.user_discount + r.items_discount),0) AS DECIMAL(18,2)) AS GrossTotal,
                   CAST(COALESCE(SUM(r.total_amount),0) AS DECIMAL(18,2)) AS NetTotal,
                   CAST(COALESCE(SUM(r.payment),0) AS DECIMAL(18,2)) AS TotalPayment,
                   CAST(COALESCE(SUM(r.cash_back),0) AS DECIMAL(18,2)) AS TotalCashBack,
                   CAST(COALESCE(SUM(r.offers_discount),0) AS DECIMAL(18,2)) AS TotalOffersDiscount,
                   CAST(COALESCE(SUM(r.user_discount),0) AS DECIMAL(18,2)) AS TotalUserDiscount,
                   CAST(COALESCE(SUM(r.items_discount),0) AS DECIMAL(18,2)) AS TotalItemsDiscount
            FROM reciepts r
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            {where};
            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, p, cancellationToken: ct));
        var items = MapSummaries(await multi.ReadAsync<ReceiptSummaryRow>());
        var total = await multi.ReadSingleAsync<int>();
        var summaryRow = await multi.ReadSingleAsync<ReceiptTotalsSummaryRow>();
        var summary = new ReceiptTotalsSummaryDto(
            summaryRow.ReceiptCount, summaryRow.GrossTotal, summaryRow.NetTotal,
            summaryRow.TotalPayment, summaryRow.TotalCashBack, summaryRow.TotalOffersDiscount,
            summaryRow.TotalUserDiscount, summaryRow.TotalItemsDiscount);
        return new ReceiptSearchResult(items, total, page, pageSize, summary);
    }

    public async Task<ReceiptDetailDto?> GetByIdAsync(long id, CancellationToken ct)
    {
        await schema.EnsureLoadedAsync(ct);
        var printedCol = schema.PrintedNumber
            ? "r.printed_number AS PrintedNumber"
            : "CAST(NULL AS BIGINT) AS PrintedNumber";
        var headerSql = $"""
            SELECT r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   CAST(r.payment AS DECIMAL(18,2)) AS Payment,
                   CAST(r.cash_back AS DECIMAL(18,2)) AS CashBack,
                   CAST(r.items_discount AS DECIMAL(18,2)) AS ItemsDiscount,
                   CAST(r.offers_discount AS DECIMAL(18,2)) AS OffersDiscount,
                   CAST(r.user_discount AS DECIMAL(18,2)) AS UserDiscount,
                   r.salesman AS SalesmanId, s.name AS SalesmanName,
                   CAST(r.synced AS bit) AS Synced, r.edr_num AS EdrNum,
                   r.discount_qr_person_id AS DiscountQrPersonId,
                   COALESCE(r.discount_qr_person_name, dqp.name) AS DiscountQrPersonName,
                   {printedCol}
            FROM reciepts r
            LEFT JOIN salesmen s ON s.id = r.salesman
            LEFT JOIN ext_discount_qr_people dqp ON dqp.id = r.discount_qr_person_id
            WHERE r.id = @id
            """;
        const string itemsSqlLegacy = """
            SELECT ri.id AS Id, ri.article_id AS ArticleId, a.Name1 AS Name, ri.barcode AS Barcode,
                   CAST(ri.quantity AS DECIMAL(18,2)) AS Quantity,
                   CAST(ri.price AS DECIMAL(18,2)) AS Price,
                   CAST(ri.original_price AS DECIMAL(18,2)) AS OriginalPrice,
                   CAST(ri.discount AS DECIMAL(18,2)) AS Discount,
                   CAST(ri.quantity * ri.price AS DECIMAL(18,2)) AS LineTotal
            FROM reciept_items ri LEFT JOIN articles a ON a.id = ri.article_id
            WHERE ri.reciept_id = @id ORDER BY ri.id
            """;
        const string itemsSql = """
            SELECT ri.id AS Id, ri.article_id AS ArticleId, a.Name1 AS Name, ri.barcode AS Barcode,
                   CAST(ri.quantity AS DECIMAL(18,2)) AS Quantity,
                   CAST(ri.price AS DECIMAL(18,2)) AS Price,
                   CAST(ri.original_price AS DECIMAL(18,2)) AS OriginalPrice,
                   CAST(ri.discount AS DECIMAL(18,2)) AS Discount,
                   CAST(ri.quantity * ri.price AS DECIMAL(18,2)) AS LineTotal,
                   COALESCE(ri.salesman_id, 0) AS SalesmanId,
                   COALESCE(ri.salesman_name, ls.name) AS SalesmanName,
                   ri.group_key AS GroupKey, ri.group_label AS GroupLabel
            FROM reciept_items ri
            LEFT JOIN articles a ON a.id = ri.article_id
            LEFT JOIN salesmen ls ON ls.id = ri.salesman_id
            WHERE ri.reciept_id = @id ORDER BY ri.id
            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var header = await conn.QuerySingleOrDefaultAsync<HeaderRow>(new CommandDefinition(headerSql, new { id }, cancellationToken: ct));
        if (header is null) return null;
        var itemsQuery = schema.LineAttribution ? itemsSql : itemsSqlLegacy;
        var items = (await conn.QueryRowsAsync<ReceiptItemDto>(new CommandDefinition(itemsQuery, new { id }, cancellationToken: ct))).ToList();
        var edits = await LoadReceiptEditsAsync(conn, id, ct);
        return new ReceiptDetailDto(header.Id, header.Number, header.CreationDate, header.TotalAmount, header.Payment,
            header.CashBack, header.ItemsDiscount, header.OffersDiscount, header.UserDiscount,
            header.SalesmanId, header.SalesmanName, header.Synced, header.EdrNum, items,
            DiscountQrPersonId: header.DiscountQrPersonId,
            DiscountQrPersonName: header.DiscountQrPersonName,
            WasEdited: edits.Count > 0,
            Edits: edits,
            PrintedNumber: header.PrintedNumber);
    }

    public async Task<IReadOnlyList<ReceiptReturnSourceDto>> GetReturnSourcesByNumberAsync(long number, CancellationToken ct)
    {
        if (number <= 0) return [];
        await schema.EnsureLoadedAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var printedCol = schema.PrintedNumber
            ? "r.printed_number AS PrintedNumber"
            : "CAST(NULL AS BIGINT) AS PrintedNumber";
        var printedMatch = schema.PrintedNumber ? " OR r.printed_number = @number" : "";
        var headerSql = $"""
            SELECT r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   r.kind AS Kind, CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   r.salesman AS SalesmanId, s.name AS SalesmanName,
                   {printedCol}
            FROM reciepts r
            LEFT JOIN salesmen s ON s.id = r.salesman
            WHERE r.is_pending = 0 AND (r.number = @number{printedMatch})
            ORDER BY CASE WHEN r.number = @number THEN 0 ELSE 1 END, r.id DESC
            """;
        var headers = (await conn.QueryAsync<ReturnHeaderRow>(
            new CommandDefinition(headerSql, new { number }, cancellationToken: ct))).ToList();
        var list = new List<ReceiptReturnSourceDto>(headers.Count);
        foreach (var header in headers)
            list.Add(await BuildReturnSourceAsync(conn, header, ct));
        return list;
    }

    public async Task<ReceiptReturnSourceDto?> GetReturnSourceByNumberAsync(long number, CancellationToken ct) =>
        (await GetReturnSourcesByNumberAsync(number, ct)).FirstOrDefault();

    public async Task<CreateReceiptResponse> CreateAsync(CreateReceiptRequest req, CancellationToken ct)
    {
        if (req.Items.Count == 0) throw new InvalidOperationException("Receipt must have items");

        await schema.EnsureLoadedAsync(ct);
        if (req.Kind == 1)
            await EnsureInvoiceReturnAllowedAsync(req, ct);

        await using var conn = await db.CreateOpenConnectionAsync(ct);

        if (schema.ClientReceiptId && req.ClientReceiptId is Guid clientId)
        {
            var existing = await FindByClientReceiptIdAsync(conn, clientId, ct);
            if (existing is not null)
                return ToCreateResponse(existing);
        }

        // Card sales and gift receipts can be routed to dedicated global cash boxes.
        var routing = await cashBoxSettings.GetAsync(ct);

        long masterAccount;
        if (req.Kind == 2 && routing.GiftMasterAccount is > 0)
        {
            masterAccount = routing.GiftMasterAccount.Value;
        }
        else if (req.Card is not null)
        {
            // Card money must ALWAYS land on the cards cash box fixed in admin settings —
            // never on the cashier's personal/default box. Unconfigured = hard rejection.
            if (routing.QiMasterAccount is not > 0)
                throw new InvalidOperationException("صندوق البطاقات غير مضبوط — اضبطه من الإعدادات ← الصناديق والأداري");
            masterAccount = routing.QiMasterAccount.Value;
        }
        else
        {
            masterAccount = await ResolveDefaultMasterAccountAsync(req, ct);
        }

        var signedSubtotal = req.Items.Sum(i => i.Quantity * i.Price);
        var subtotal = req.Kind == 1 ? Math.Abs(signedSubtotal) : signedSubtotal;
        var total = Math.Max(0, subtotal - req.UserDiscount);
        var offersDiscount = req.Items.Sum(i =>
            Math.Abs(i.Quantity) * Math.Max(0, i.OriginalPrice - i.Price));
        var cashBack = req.IsPending ? 0 : Math.Max(0, req.Payment - total);

        await using var tx = await conn.BeginTransactionAsync(ct);

        try
        {
            var renumbered = false;
            long number;
            if (req.IsPending)
            {
                number = 0L;
            }
            else if (await receiptNumbers.AdoptClientNumberAsync(conn, tx, req.CashierId, req.Number, ct) is { } adopted)
            {
                number = adopted;
                // Rare: the client number already exists anywhere in the shop.
                if (await NumberInUseAsync(conn, tx, number, ct))
                {
                    number = await receiptNumbers.AllocateAsync(conn, tx, req.CashierId, ct);
                    renumbered = true;
                }
            }
            else
            {
                number = await receiptNumbers.AllocateAsync(conn, tx, req.CashierId, ct);
                renumbered = req.Number is > 0;
            }

            var qrPerson = req.UserDiscount > 0
                ? await discountQr.ResolveForReceiptAsync(req.DiscountQrPersonId, req.DiscountQrPersonCode, ct)
                : null;
            long? printedNumber = !req.IsPending && req.Number is > 0 && req.Number.Value != number
                ? req.Number
                : null;
            var receiptId = await InsertReceiptAsync(conn, tx, req, number, total, offersDiscount, cashBack, masterAccount, qrPerson, printedNumber, ct);

            var headerSalesman = ResolveHeaderSalesman(req);
            foreach (var item in req.Items)
                await InsertReceiptItemAsync(conn, tx, receiptId, req.Kind, item, headerSalesman, ct);

            if (req.Card is not null)
                await InsertCardPaymentAsync(conn, tx, receiptId, req.Card, ct);

            if (schema.ReceiptEdits)
                await InsertReceiptEditsAsync(conn, tx, receiptId, req.EditHistory, ct);

            await tx.CommitAsync(ct);

            if (!req.IsPending)
                sideEffects.ScheduleSaleCommitted(receiptId, number, req.CashierId, req.PosId, ResolveHeaderSalesman(req));

            return new CreateReceiptResponse(receiptId, number, total, cashBack, renumbered);
        }
        catch (SqlException ex) when (IsDuplicateKey(ex) && schema.ClientReceiptId && req.ClientReceiptId is Guid dupId)
        {
            await SafeRollbackAsync(tx);
            var existing = await FindByClientReceiptIdAsync(conn, dupId, ct);
            if (existing is not null)
                return ToCreateResponse(existing);
            throw;
        }
        catch
        {
            await SafeRollbackAsync(tx);
            throw;
        }
    }

    public async Task<ReceiptDetailDto?> SetPrintedNumberAsync(long id, long? printedNumber, CancellationToken ct)
    {
        await schema.EnsureLoadedAsync(ct);
        if (!schema.PrintedNumber)
            throw new InvalidOperationException("حدّث برنامج الخادم لربط الرقم المطبوع بالفاتورة");

        if (printedNumber is <= 0) printedNumber = null;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var official = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT number FROM reciepts WHERE id = @id",
            new { id }, cancellationToken: ct));
        if (official is null) return null;
        if (printedNumber == official) printedNumber = null;

        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE reciepts SET printed_number = @printedNumber WHERE id = @id",
            new { id, printedNumber }, cancellationToken: ct));
        return await GetByIdAsync(id, ct);
    }

    /// <summary>
    /// Reserves the next official receipt number for this cashier so the POS can print it
    /// before the sale is posted. Create then adopts the same number (seq == last_seq).
    /// </summary>
    public async Task<AllocateReceiptNumberResponse> AllocateNumberAsync(long cashierId, CancellationToken ct)
    {
        if (cashierId <= 0)
            throw new InvalidOperationException("الكاشير غير محدد");

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        try
        {
            var number = await receiptNumbers.AllocateAsync(conn, tx, cashierId, ct);
            ReceiptNumberFormatter.TryDecompose(number, out var year, out var cashierCode, out var seq);
            await tx.CommitAsync(ct);
            return new AllocateReceiptNumberResponse(number, year, cashierCode, seq);
        }
        catch
        {
            await SafeRollbackAsync(tx);
            throw;
        }
    }

    private async Task<long> ResolveDefaultMasterAccountAsync(CreateReceiptRequest req, CancellationToken ct)
    {
        var masterAccount = req.MasterAccount ?? 0;
        if (masterAccount <= 0)
        {
            var boxes = await sections.GetCashBoxesForCashierAsync(req.CashierId, ct);
            var defaultBox = boxes.FirstOrDefault(b => b.IsDefault) ?? boxes.FirstOrDefault();
            if (defaultBox is null)
                throw new InvalidOperationException("لا يوجد صندوق مرتبط بقسم الكاشير");
            masterAccount = defaultBox.MasterAccount;
        }
        else if (!await sections.ValidateCashBoxForCashierAsync(req.CashierId, masterAccount, ct))
            throw new InvalidOperationException("الصندوق المختار غير مسموح لهذا الكاشير");

        return masterAccount;
    }

    private static CreateReceiptResponse ToCreateResponse(ExistingReceiptRow row) =>
        new(row.Id, row.Number, row.TotalAmount, row.CashBack);

    private static async Task<ExistingReceiptRow?> FindByClientReceiptIdAsync(
        System.Data.Common.DbConnection conn, Guid clientId, CancellationToken ct) =>
        await conn.QuerySingleOrDefaultAsync<ExistingReceiptRow>(new CommandDefinition("""
            SELECT id AS Id, number AS Number,
                   CAST(total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   CAST(cash_back AS DECIMAL(18,2)) AS CashBack
            FROM reciepts WHERE client_receipt_id = @clientId
            """, new { clientId }, cancellationToken: ct));

    /// <summary>
    /// The receipt header carries a salesman only when the whole receipt belongs to one.
    ///
    /// It used to take <c>req.SalesmanId</c> whenever it was non-zero, and the terminal always sent
    /// the salesman it was seeded with at login. So receipts nobody was credited for were stamped
    /// with the first salesman in the list, and receipts where the cashier picked someone per line
    /// still showed that first salesman. The lines are the truth: one distinct salesman becomes the
    /// header, several means the receipt has no single owner (Edari gets none and the per-line
    /// detail drives commissions and targets), and none leaves it empty.
    /// </summary>
    private static long ResolveHeaderSalesman(CreateReceiptRequest req)
    {
        var distinct = req.Items
            .Where(i => i.SalesmanId > 0)
            .Select(i => i.SalesmanId)
            .Distinct()
            .ToList();

        if (distinct.Count == 1) return distinct[0];
        if (distinct.Count > 1) return 0;
        return req.SalesmanId > 0 ? req.SalesmanId : 0;
    }

    /// <summary>Whether any posted receipt already occupies this display number in the shop.</summary>
    private static async Task<bool> NumberInUseAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        long number,
        CancellationToken ct) =>
        await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT COUNT(1) FROM reciepts WITH (UPDLOCK, HOLDLOCK)
            WHERE number = @number AND state = 0
            """, new { number }, transaction: tx, cancellationToken: ct)) > 0;

    private async Task<long> InsertReceiptAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        CreateReceiptRequest req,
        long number,
        decimal total,
        decimal offersDiscount,
        decimal cashBack,
        long masterAccount,
        (long Id, string Name)? qrPerson,
        long? printedNumber,
        CancellationToken ct)
    {
        var soldAt = NormalizeSoldAt(req.SoldAt);
        var args = new
        {
            number,
            creationDate = soldAt ?? DateTime.Now,
            kind = req.Kind,
            cashierId = req.CashierId,
            total,
            offersDiscount,
            userDiscount = req.UserDiscount,
            payment = req.IsPending ? 0 : req.Payment,
            cashBack,
            salesmanId = ResolveHeaderSalesman(req),
            posId = req.PosId,
            accountId = req.AccountId ?? 0,
            isPending = req.IsPending ? 1 : 0,
            masterAccount,
            clientReceiptId = req.ClientReceiptId,
            returnOfReceiptId = req.Kind == 1 ? req.ReturnOfReceiptId : null,
            discountQrPersonId = qrPerson?.Id,
            discountQrPersonName = qrPerson?.Name,
            printedNumber
        };
        var createdExpr = soldAt.HasValue ? "@creationDate" : "GETDATE()";

        var extraCols = "";
        var extraVals = "";
        if (schema.ClientReceiptId)
        {
            extraCols += ", client_receipt_id";
            extraVals += ", @clientReceiptId";
        }
        if (schema.ReturnOfReceiptId)
        {
            extraCols += ", return_of_receipt_id";
            extraVals += ", @returnOfReceiptId";
        }
        if (schema.DiscountQrPerson)
        {
            extraCols += ", discount_qr_person_id, discount_qr_person_name";
            extraVals += ", @discountQrPersonId, @discountQrPersonName";
        }
        if (schema.PrintedNumber)
        {
            extraCols += ", printed_number";
            extraVals += ", @printedNumber";
        }

        return await conn.ExecuteScalarAsync<long>(new CommandDefinition($"""
            INSERT INTO reciepts (
                number, creation_date, kind, cashier_id, total_amount, items_discount, offers_discount,
                user_discount, payment, cash_back, account, salesman, state, point_of_sale_id,
                synced, is_pending, master_account{extraCols}
            )
            OUTPUT INSERTED.id
            VALUES (
                @number, {createdExpr}, @kind, @cashierId, @total, 0, @offersDiscount,
                @userDiscount, @payment, @cashBack, @accountId, @salesmanId, 0, @posId,
                0, @isPending, @masterAccount{extraVals}
            )
            """, args, transaction: tx, cancellationToken: ct));
    }

    private async Task InsertReceiptItemAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        long receiptId,
        int kind,
        CreateReceiptItemRequest item,
        long headerSalesman,
        CancellationToken ct)
    {
        var qty = kind == 1 ? Math.Abs(item.Quantity) : item.Quantity;
        var legacy = new
        {
            receiptId,
            articleId = item.ArticleId,
            quantity = qty,
            price = item.Price,
            discount = item.Discount,
            originalPrice = item.OriginalPrice,
            barcode = item.Barcode
        };

        if (schema.LineAttribution)
        {
            try
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO reciept_items (
                        reciept_id, article_id, quantity, price, discount, kind, original_price, barcode,
                        salesman_id, salesman_name, group_key, group_label)
                    VALUES (
                        @receiptId, @articleId, @quantity, @price, @discount, 0, @originalPrice, @barcode,
                        @salesmanId, @salesmanName, @groupKey, @groupLabel)
                    """, new
                {
                    receiptId,
                    articleId = item.ArticleId,
                    quantity = qty,
                    price = item.Price,
                    discount = item.Discount,
                    originalPrice = item.OriginalPrice,
                    barcode = item.Barcode,
                    // A whole-receipt salesman still reaches every line, so commissions and targets
                    // read the same value no matter which mode the cashier is working in.
                    salesmanId = item.SalesmanId > 0 ? item.SalesmanId : (headerSalesman > 0 ? headerSalesman : (long?)null),
                    salesmanName = string.IsNullOrWhiteSpace(item.SalesmanName) ? null : item.SalesmanName.Trim(),
                    groupKey = item.GroupKey,
                    groupLabel = string.IsNullOrWhiteSpace(item.GroupLabel) ? null : item.GroupLabel.Trim()
                }, transaction: tx, cancellationToken: ct));
                return;
            }
            catch (SqlException ex) when (IsMissingColumn(ex))
            {
                schema.DisableLineAttribution();
            }
        }

        await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO reciept_items (reciept_id, article_id, quantity, price, discount, kind, original_price, barcode)
            VALUES (@receiptId, @articleId, @quantity, @price, @discount, 0, @originalPrice, @barcode)
            """, legacy, transaction: tx, cancellationToken: ct));
    }

    private static async Task InsertCardPaymentAsync(
        System.Data.Common.DbConnection conn, System.Data.Common.DbTransaction tx,
        long receiptId, CardPaymentDto card, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO reciept_credit_card (
                reciept_id, rrn, terminalId, timestamp, acquirer, accNo, cardHolderName, amount, synced,
                card_type, auth_code, batch_no, ref_no, merchant_name, currency_code, device_type, created_at)
            VALUES (
                @receiptId, @rrn, @terminalId, @timestamp, @acquirer, @accNo, @cardName, @amount, 0,
                @cardType, @authCode, @batchNo, @refNo, @merchantName, @currencyCode, @deviceType, GETDATE())
            """, new
        {
            receiptId,
            rrn = Text(card.Rrn),
            terminalId = Text(card.TerminalId),
            timestamp = card.TransTime ?? DateTime.Now,
            acquirer = Text(card.Acquirer),
            accNo = Text(card.AccNo),
            cardName = Text(card.CardName),
            amount = (long)Math.Round(card.Amount, MidpointRounding.AwayFromZero),
            cardType = card.CardType,
            authCode = card.AuthCode,
            batchNo = card.BatchNo,
            refNo = card.RefNo,
            merchantName = card.MerchantName,
            currencyCode = card.CurrencyCode,
            deviceType = card.DeviceType
        }, transaction: tx, cancellationToken: ct));
    }

    /// <summary>The inherited card columns are NOT NULL, so missing values become empty.</summary>
    private static string Text(string? value) => value?.Trim() ?? "";

    public async Task<IReadOnlyList<HoldReceiptDto>> ListAllHoldAsync(long? sectionId, long? posId, CancellationToken ct)
    {
        var where = "WHERE r.is_pending = 1";
        var p = new DynamicParameters();
        if (posId.HasValue) { where += " AND r.point_of_sale_id = @posId"; p.Add("posId", posId); }
        if (sectionId.HasValue) { where += " AND sec.id = @sectionId"; p.Add("sectionId", sectionId); }

        var sql = $"""
            SELECT r.id AS Id, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   r.salesman AS SalesmanId, s.name AS SalesmanName,
                   (SELECT COUNT(*) FROM reciept_items ri WHERE ri.reciept_id = r.id) AS ItemCount,
                   r.point_of_sale_id AS PosId, pos.name AS PosName,
                   sec.name AS SectionName, c.username AS CashierName
            FROM reciepts r
            LEFT JOIN salesmen s ON s.id = r.salesman
            LEFT JOIN point_of_sales pos ON pos.id = r.point_of_sale_id
            LEFT JOIN cashiers c ON c.id = r.cashier_id
            LEFT JOIN sections sec ON sec.id = COALESCE(NULLIF(pos.section_id, 0), c.section_id)
            {where}
            ORDER BY r.id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return MapHolds(await conn.QueryAsync<HoldRow>(new CommandDefinition(sql, p, cancellationToken: ct)));
    }

    public async Task<IReadOnlyList<HoldReceiptDto>> ListHoldAsync(long? posId, CancellationToken ct)
    {
        var where = "WHERE r.is_pending = 1";
        var p = new DynamicParameters();
        if (posId.HasValue) { where += " AND r.point_of_sale_id = @posId"; p.Add("posId", posId); }

        var sql = $"""
            SELECT r.id AS Id, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   r.salesman AS SalesmanId, s.name AS SalesmanName,
                   (SELECT COUNT(*) FROM reciept_items ri WHERE ri.reciept_id = r.id) AS ItemCount
            FROM reciepts r LEFT JOIN salesmen s ON s.id = r.salesman
            {where} ORDER BY r.id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return MapHolds(await conn.QueryAsync<HoldRow>(new CommandDefinition(sql, p, cancellationToken: ct)));
    }

    public async Task<ReceiptDetailDto?> CompleteHoldAsync(long holdId, decimal payment, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        long salesmanId = 0;
        long cashierId = 0;
        long number;
        try
        {
            var hold = await conn.QuerySingleOrDefaultAsync<(long Id, decimal Total, int IsPending, long SalesmanId, long CashierId)>(
                new CommandDefinition("""
                    SELECT id,
                           CAST(total_amount AS DECIMAL(18,2)) AS Total,
                           is_pending AS IsPending,
                           salesman AS SalesmanId,
                           cashier_id AS CashierId
                    FROM reciepts WITH (UPDLOCK, HOLDLOCK) WHERE id=@id
                    """, new { id = holdId }, transaction: tx, cancellationToken: ct));
            if (hold.Id == 0)
            {
                await SafeRollbackAsync(tx);
                return null;
            }
            if (hold.IsPending != 1)
            {
                await SafeRollbackAsync(tx);
                return await GetByIdAsync(holdId, ct);
            }

            salesmanId = hold.SalesmanId;
            cashierId = hold.CashierId;
            if (cashierId <= 0)
            {
                await SafeRollbackAsync(tx);
                throw new InvalidOperationException("الفاتورة المعلّقة لا تحتوي كاشيراً");
            }
            number = await receiptNumbers.AllocateAsync(conn, tx, cashierId, ct);
            var cashBack = Math.Max(0, payment - hold.Total);

            var rows = await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE reciepts SET is_pending=0, number=@number, payment=@payment, cash_back=@cashBack
                WHERE id=@id AND is_pending=1
                """, new { id = holdId, number, payment, cashBack }, transaction: tx, cancellationToken: ct));
            if (rows == 0)
            {
                await SafeRollbackAsync(tx);
                return await GetByIdAsync(holdId, ct);
            }

            await tx.CommitAsync(ct);
        }
        catch
        {
            await SafeRollbackAsync(tx);
            throw;
        }

        sideEffects.ScheduleHoldCompleted(holdId, number, salesmanId);

        return await GetByIdAsync(holdId, ct);
    }

    private static IReadOnlyList<HoldReceiptDto> MapHolds(IEnumerable<HoldRow> rows) =>
        rows.Select(r => new HoldReceiptDto(
            r.Id, r.CreationDate, r.TotalAmount, r.ItemCount, r.SalesmanId, r.SalesmanName,
            r.PosId, r.PosName, r.SectionName, r.CashierName)).ToList();

    private static IReadOnlyList<ReceiptSummaryDto> MapSummaries(IEnumerable<ReceiptSummaryRow> rows) =>
        rows.Select(r => new ReceiptSummaryDto(
            r.Id, r.Number, r.CreationDate, r.TotalAmount, r.Payment, r.CashBack,
            r.SalesmanId, r.SalesmanName, r.PosId, r.PosName, r.Synced, r.EdrNum, r.ItemCount,
            r.ItemsDiscount, r.OffersDiscount, r.UserDiscount, r.Kind, r.CashierId, r.CashierName,
            r.AccountName, r.SectionId, r.SectionName, r.SyncDate, r.CardAmount, r.CardName,
            r.CardAcquirer, r.CardAccNo, r.CardRrn, r.CardTerminalId, r.CardAuthCode,
            r.CardTransTime, r.CardType, r.CardRefNo,
            r.MasterAccount, r.CashBoxNum, r.CashBoxName, r.SalesmanCount,
            r.DiscountQrPersonId, r.DiscountQrPersonName, r.WasEdited)).ToList();

    private sealed class HoldRow
    {
        public long Id { get; set; }
        public DateTime CreationDate { get; set; }
        public decimal TotalAmount { get; set; }
        public int ItemCount { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public long? PosId { get; set; }
        public string? PosName { get; set; }
        public string? SectionName { get; set; }
        public string? CashierName { get; set; }
    }

    private sealed class ReceiptTotalsSummaryRow
    {
        public int ReceiptCount { get; set; }
        public decimal GrossTotal { get; set; }
        public decimal NetTotal { get; set; }
        public decimal TotalPayment { get; set; }
        public decimal TotalCashBack { get; set; }
        public decimal TotalOffersDiscount { get; set; }
        public decimal TotalUserDiscount { get; set; }
        public decimal TotalItemsDiscount { get; set; }
    }

    private sealed class ReceiptSummaryRow
    {
        public long Id { get; set; }
        public long Number { get; set; }
        public DateTime CreationDate { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal Payment { get; set; }
        public decimal CashBack { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public long? PosId { get; set; }
        public string? PosName { get; set; }
        public bool Synced { get; set; }
        public long? EdrNum { get; set; }
        public int ItemCount { get; set; }
        public decimal ItemsDiscount { get; set; }
        public decimal OffersDiscount { get; set; }
        public decimal UserDiscount { get; set; }
        public int Kind { get; set; }
        public long? CashierId { get; set; }
        public string? CashierName { get; set; }
        public string? AccountName { get; set; }
        public long? SectionId { get; set; }
        public string? SectionName { get; set; }
        public DateTime? SyncDate { get; set; }
        public decimal? CardAmount { get; set; }
        public string? CardName { get; set; }
        public string? CardAcquirer { get; set; }
        public string? CardAccNo { get; set; }
        public string? CardRrn { get; set; }
        public string? CardTerminalId { get; set; }
        public string? CardAuthCode { get; set; }
        public DateTime? CardTransTime { get; set; }
        public string? CardType { get; set; }
        public string? CardRefNo { get; set; }
        public long? MasterAccount { get; set; }
        public string? CashBoxNum { get; set; }
        public string? CashBoxName { get; set; }
        public int SalesmanCount { get; set; }
        public long? DiscountQrPersonId { get; set; }
        public string? DiscountQrPersonName { get; set; }
        public bool WasEdited { get; set; }
    }

    private static readonly JsonSerializerOptions EditJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static DateTime? NormalizeSoldAt(DateTime? soldAt)
    {
        if (soldAt is not DateTime sold || sold == default) return null;
        return sold.Kind == DateTimeKind.Utc ? sold.ToLocalTime() : sold;
    }

    private async Task InsertReceiptEditsAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        long receiptId,
        ReceiptEditHistoryDto? history,
        CancellationToken ct)
    {
        var revisions = history?.Revisions;
        if (revisions is null || revisions.Count == 0) return;

        foreach (var rev in revisions)
        {
            if (rev.Before is null || rev.After is null) continue;
            var editedAt = rev.EditedAt == default ? DateTime.Now : NormalizeSoldAt(rev.EditedAt) ?? DateTime.Now;
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_receipt_edits (receipt_id, edited_at, before_json, after_json)
                VALUES (@receiptId, @editedAt, @beforeJson, @afterJson)
                """, new
            {
                receiptId,
                editedAt,
                beforeJson = JsonSerializer.Serialize(rev.Before, EditJson),
                afterJson = JsonSerializer.Serialize(rev.After, EditJson)
            }, transaction: tx, cancellationToken: ct));
        }
    }

    private async Task<IReadOnlyList<ReceiptEditRevisionDto>> LoadReceiptEditsAsync(
        System.Data.Common.DbConnection conn, long receiptId, CancellationToken ct)
    {
        if (!schema.ReceiptEdits) return [];
        var rows = await conn.QueryAsync<(DateTime EditedAt, string BeforeJson, string AfterJson)>(new CommandDefinition("""
            SELECT edited_at AS EditedAt, before_json AS BeforeJson, after_json AS AfterJson
            FROM ext_receipt_edits
            WHERE receipt_id = @receiptId
            ORDER BY id
            """, new { receiptId }, cancellationToken: ct));
        var list = new List<ReceiptEditRevisionDto>();
        foreach (var row in rows)
        {
            try
            {
                var before = JsonSerializer.Deserialize<ReceiptEditSnapshotDto>(row.BeforeJson, EditJson);
                var after = JsonSerializer.Deserialize<ReceiptEditSnapshotDto>(row.AfterJson, EditJson);
                if (before is null || after is null) continue;
                list.Add(new ReceiptEditRevisionDto(row.EditedAt, before, after));
            }
            catch (JsonException)
            {
                /* skip a corrupt snapshot rather than failing the receipt */
            }
        }
        return list;
    }

    private async Task EnsureInvoiceReturnAllowedAsync(CreateReceiptRequest req, CancellationToken ct)
    {
        var bound = false;
        await using (var conn = await db.CreateOpenConnectionAsync(ct))
        {
            bound = await conn.ExecuteScalarAsync<bool?>(new CommandDefinition("""
                SELECT CAST(COALESCE(p.invoice_bound_return, 0) AS bit)
                FROM cashiers c
                LEFT JOIN cashiers_permissions p ON p.id = c.cashiers_permissions_id
                WHERE c.id = @cashierId
                """, new { cashierId = req.CashierId }, cancellationToken: ct)) ?? false;
        }

        if (bound && req.ReturnOfReceiptId is not > 0)
            throw new InvalidOperationException("المردود مربوط برقم الفاتورة — امسح باركود الفاتورة أو أدخل رقمها");
        if (req.ReturnOfReceiptId is not > 0) return;

        var source = await GetReturnSourceByIdAsync(req.ReturnOfReceiptId.Value, ct)
            ?? throw new InvalidOperationException("فاتورة البيع الأصلية غير موجودة");
        if (source.Kind != 0)
            throw new InvalidOperationException("لا يمكن الإرجاع إلا من فاتورة بيع");

        var remain = source.Items.Select(i => new ReturnRemain
        {
            ArticleId = i.ArticleId,
            SalesmanId = i.SalesmanId,
            Price = i.Price,
            Left = i.RemainingQty
        }).ToList();

        foreach (var item in req.Items)
        {
            var qty = Math.Abs(item.Quantity);
            for (var i = 0; i < remain.Count && qty > 0; i++)
            {
                var row = remain[i];
                if (row.ArticleId != item.ArticleId || row.Left <= 0) continue;
                if (item.SalesmanId > 0 && row.SalesmanId > 0 && row.SalesmanId != item.SalesmanId) continue;
                if (Math.Abs(row.Price - item.Price) > 0.01m) continue;
                var take = Math.Min(row.Left, qty);
                row.Left -= take;
                qty -= take;
            }
            if (qty > 0)
                throw new InvalidOperationException("كمية المردود أكبر من المتبقي في الفاتورة الأصلية");
        }
    }

    private async Task<ReceiptReturnSourceDto?> GetReturnSourceByIdAsync(long id, CancellationToken ct)
    {
        await schema.EnsureLoadedAsync(ct);
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        const string headerSql = """
            SELECT r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   r.kind AS Kind, CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   r.salesman AS SalesmanId, s.name AS SalesmanName
            FROM reciepts r
            LEFT JOIN salesmen s ON s.id = r.salesman
            WHERE r.id = @id AND r.is_pending = 0
            """;
        var header = await conn.QuerySingleOrDefaultAsync<ReturnHeaderRow>(
            new CommandDefinition(headerSql, new { id }, cancellationToken: ct));
        if (header is null) return null;
        return await BuildReturnSourceAsync(conn, header, ct);
    }

    private async Task<ReceiptReturnSourceDto> BuildReturnSourceAsync(
        System.Data.Common.DbConnection conn, ReturnHeaderRow header, CancellationToken ct)
    {
        const string itemsSql = """
            SELECT ri.id AS ItemId, ri.article_id AS ArticleId, a.Name1 AS Name, ri.barcode AS Barcode,
                   CAST(ri.quantity AS DECIMAL(18,2)) AS SoldQty,
                   CAST(ri.price AS DECIMAL(18,2)) AS Price,
                   CAST(ri.original_price AS DECIMAL(18,2)) AS OriginalPrice,
                   CAST(ri.discount AS DECIMAL(18,2)) AS Discount,
                   COALESCE(ri.salesman_id, 0) AS SalesmanId,
                   COALESCE(ri.salesman_name, ls.name) AS SalesmanName,
                   ri.group_key AS GroupKey, ri.group_label AS GroupLabel
            FROM reciept_items ri
            LEFT JOIN articles a ON a.id = ri.article_id
            LEFT JOIN salesmen ls ON ls.id = ri.salesman_id
            WHERE ri.reciept_id = @id
            ORDER BY ri.id
            """;
        const string itemsSqlLegacy = """
            SELECT ri.id AS ItemId, ri.article_id AS ArticleId, a.Name1 AS Name, ri.barcode AS Barcode,
                   CAST(ri.quantity AS DECIMAL(18,2)) AS SoldQty,
                   CAST(ri.price AS DECIMAL(18,2)) AS Price,
                   CAST(ri.original_price AS DECIMAL(18,2)) AS OriginalPrice,
                   CAST(ri.discount AS DECIMAL(18,2)) AS Discount,
                   CAST(0 AS bigint) AS SalesmanId,
                   CAST(NULL AS nvarchar(200)) AS SalesmanName,
                   CAST(NULL AS int) AS GroupKey,
                   CAST(NULL AS nvarchar(100)) AS GroupLabel
            FROM reciept_items ri
            LEFT JOIN articles a ON a.id = ri.article_id
            WHERE ri.reciept_id = @id
            ORDER BY ri.id
            """;
        var raw = (await conn.QueryAsync<ReturnLineRow>(new CommandDefinition(
            schema.LineAttribution ? itemsSql : itemsSqlLegacy,
            new { id = header.Id }, cancellationToken: ct))).ToList();

        var returned = new List<ReturnedBucket>();
        if (schema.ReturnOfReceiptId)
        {
            returned = (await conn.QueryAsync<ReturnedBucket>(new CommandDefinition("""
                SELECT ri.article_id AS ArticleId,
                       COALESCE(ri.salesman_id, 0) AS SalesmanId,
                       CAST(ri.price AS DECIMAL(18,2)) AS Price,
                       CAST(SUM(ABS(ri.quantity)) AS DECIMAL(18,2)) AS Qty
                FROM reciepts r
                INNER JOIN reciept_items ri ON ri.reciept_id = r.id
                WHERE r.return_of_receipt_id = @id AND r.kind = 1 AND r.is_pending = 0
                GROUP BY ri.article_id, COALESCE(ri.salesman_id, 0), ri.price
                """, new { id = header.Id }, cancellationToken: ct))).ToList();
        }

        var lines = new List<ReceiptReturnLineDto>(raw.Count);
        foreach (var item in raw)
        {
            var take = Math.Min(item.SoldQty, TakeReturned(returned, item.ArticleId, item.SalesmanId, item.Price, item.SoldQty));
            lines.Add(new ReceiptReturnLineDto(
                item.ItemId, item.ArticleId, item.Name, item.Barcode,
                item.SoldQty, take, Math.Max(0, item.SoldQty - take),
                item.Price, item.OriginalPrice, item.Discount,
                item.SalesmanId, item.SalesmanName, item.GroupKey, item.GroupLabel));
        }

        return new ReceiptReturnSourceDto(
            header.Id, header.Number, header.CreationDate, header.Kind, header.TotalAmount,
            header.SalesmanId, header.SalesmanName, lines, header.PrintedNumber);
    }

    private static decimal TakeReturned(List<ReturnedBucket> buckets, long articleId, long salesmanId, decimal price, decimal max)
    {
        var left = max;
        var taken = 0m;
        foreach (var bucket in buckets)
        {
            if (left <= 0) break;
            if (bucket.ArticleId != articleId || bucket.Qty <= 0) continue;
            if (bucket.SalesmanId > 0 && salesmanId > 0 && bucket.SalesmanId != salesmanId) continue;
            if (Math.Abs(bucket.Price - price) > 0.01m) continue;
            var take = Math.Min(bucket.Qty, left);
            bucket.Qty -= take;
            taken += take;
            left -= take;
        }
        return taken;
    }

    private sealed class ReturnHeaderRow
    {
        public long Id { get; set; }
        public long Number { get; set; }
        public DateTime CreationDate { get; set; }
        public int Kind { get; set; }
        public decimal TotalAmount { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public long? PrintedNumber { get; set; }
    }

    private sealed class ReturnLineRow
    {
        public long ItemId { get; set; }
        public long ArticleId { get; set; }
        public string? Name { get; set; }
        public string? Barcode { get; set; }
        public decimal SoldQty { get; set; }
        public decimal Price { get; set; }
        public decimal OriginalPrice { get; set; }
        public decimal Discount { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public int? GroupKey { get; set; }
        public string? GroupLabel { get; set; }
    }

    private sealed class ReturnedBucket
    {
        public long ArticleId { get; set; }
        public long SalesmanId { get; set; }
        public decimal Price { get; set; }
        public decimal Qty { get; set; }
    }

    private sealed class ReturnRemain
    {
        public long ArticleId { get; set; }
        public long SalesmanId { get; set; }
        public decimal Price { get; set; }
        public decimal Left { get; set; }
    }

    private sealed class HeaderRow
    {
        public long Id { get; set; }
        public long Number { get; set; }
        public DateTime CreationDate { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal Payment { get; set; }
        public decimal CashBack { get; set; }
        public decimal ItemsDiscount { get; set; }
        public decimal OffersDiscount { get; set; }
        public decimal UserDiscount { get; set; }
        public long SalesmanId { get; set; }
        public string? SalesmanName { get; set; }
        public bool Synced { get; set; }
        public long? EdrNum { get; set; }
        public long? DiscountQrPersonId { get; set; }
        public string? DiscountQrPersonName { get; set; }
        public long? PrintedNumber { get; set; }
    }

    private sealed record ExistingReceiptRow(long Id, long Number, decimal TotalAmount, decimal CashBack);
}
