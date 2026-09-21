using Dapper;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class SectionRepository(ISqlConnectionFactory db, CashBoxAccountRepository cashBoxes, EdariSectionPushService edariPush)
{
    private const string SummarySql = """
        SELECT
            s.id AS Id, s.name AS Name, s.branch_id AS BranchId, b.name AS BranchName,
            CAST(s.state AS bit) AS State, s.sell_price AS SellPrice,
            COALESCE(s.edari_branch_id, 1) AS EdariBranchId,
            COALESCE(s.edari_warehouse_number, 1) AS EdariWarehouseNumber,
            COALESCE(def.master_account, s.master_account, 0) AS MasterAccount,
            COALESCE(cb.CashBoxCount, 0) AS CashBoxCount,
            COALESCE(tc.TerminalCount, 0) AS TerminalCount,
            COALESCE(tc.OnlineTerminals, 0) AS OnlineTerminals,
            COALESCE(rs.TodayReceipts, 0) AS TodayReceipts,
            COALESCE(rs.TodaySales, 0) AS TodaySales
        FROM sections s
        LEFT JOIN branches b ON b.id = s.branch_id
        LEFT JOIN (
            SELECT section_id, master_account
            FROM section_cashboxes WHERE is_default = 1
        ) def ON def.section_id = s.id
        LEFT JOIN (
            SELECT section_id, COUNT(*) AS CashBoxCount
            FROM section_cashboxes GROUP BY section_id
        ) cb ON cb.section_id = s.id
        LEFT JOIN (
            SELECT section_id,
                   COUNT(*) AS TerminalCount,
                   SUM(CASE WHEN last_connection > DATEADD(minute, -5, GETDATE()) THEN 1 ELSE 0 END) AS OnlineTerminals
            FROM point_of_sales
            WHERE COALESCE(is_deleted, 0) = 0
            GROUP BY section_id
        ) tc ON tc.section_id = s.id
        LEFT JOIN (
            SELECT p.section_id,
                   COUNT(*) AS TodayReceipts,
                   SUM(CAST(r.total_amount AS DECIMAL(18,2))) AS TodaySales
            FROM reciepts r
            INNER JOIN point_of_sales p ON p.id = r.point_of_sale_id
            WHERE CAST(r.creation_date AS date) = CAST(GETDATE() AS date)
              AND COALESCE(r.is_pending, 0) = 0
            GROUP BY p.section_id
        ) rs ON rs.section_id = s.id
        """;

    public async Task<IReadOnlyList<SectionSummaryDto>> ListSummariesAsync(CancellationToken ct)
    {
        var sql = SummarySql + " ORDER BY s.name";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<SectionSummaryDto>(
            new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<IReadOnlyList<SectionDto>> ListBasicAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, name AS Name, branch_id AS BranchId,
                   CAST(state AS bit) AS State, sell_price AS SellPrice
            FROM sections ORDER BY name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowsAsync<SectionDto>(new CommandDefinition(sql, cancellationToken: ct));
    }

    public async Task<SectionDetailDto?> GetDetailAsync(long id, CancellationToken ct)
    {
        const string sql = """
            SELECT
                s.id AS Id, s.name AS Name, s.branch_id AS BranchId, b.name AS BranchName,
                CAST(s.state AS bit) AS State, s.sell_price AS SellPrice,
                COALESCE(s.edari_branch_id, 1) AS EdariBranchId,
                COALESCE(s.edari_warehouse_number, 1) AS EdariWarehouseNumber,
                COALESCE(s.groups_columns_count, 4) AS GroupsColumnsCount,
                COALESCE(s.groups_item_size, 80) AS GroupsItemSize,
                COALESCE(s.round_total_to, 0) AS RoundTotalTo,
                COALESCE(s.round_item_to, 0) AS RoundItemTo,
                CAST(COALESCE(s.fast_saving, 0) AS bit) AS FastSaving,
                CAST(COALESCE(s.collective_printing, 0) AS bit) AS CollectivePrinting,
                CAST(COALESCE(s.display_article_quantity, 0) AS bit) AS DisplayArticleQuantity,
                COALESCE(tc.TerminalCount, 0) AS TerminalCount,
                COALESCE(tc.OnlineTerminals, 0) AS OnlineTerminals,
                COALESCE(rs.TodayReceipts, 0) AS TodayReceipts,
                COALESCE(rs.TodaySales, 0) AS TodaySales
            FROM sections s
            LEFT JOIN branches b ON b.id = s.branch_id
            LEFT JOIN (
                SELECT section_id,
                       COUNT(*) AS TerminalCount,
                       SUM(CASE WHEN last_connection > DATEADD(minute, -5, GETDATE()) THEN 1 ELSE 0 END) AS OnlineTerminals
                FROM point_of_sales
                WHERE COALESCE(is_deleted, 0) = 0
                GROUP BY section_id
            ) tc ON tc.section_id = s.id
            LEFT JOIN (
                SELECT p.section_id,
                       COUNT(*) AS TodayReceipts,
                       SUM(CAST(r.total_amount AS DECIMAL(18,2))) AS TodaySales
                FROM reciepts r
                INNER JOIN point_of_sales p ON p.id = r.point_of_sale_id
                WHERE CAST(r.creation_date AS date) = CAST(GETDATE() AS date)
                  AND COALESCE(r.is_pending, 0) = 0
                GROUP BY p.section_id
            ) rs ON rs.section_id = s.id
            WHERE s.id = @id
            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<SectionDetailRow>(
            new CommandDefinition(sql, new { id }, cancellationToken: ct));
        if (row is null) return null;

        var cashBoxList = await GetCashBoxesAsync(id, ct);
        var terminals = await GetTerminalsAsync(conn, id, ct);

        return new SectionDetailDto(
            row.Id, row.Name, row.BranchId, row.BranchName, row.State, row.SellPrice,
            row.EdariBranchId, row.EdariWarehouseNumber,
            row.GroupsColumnsCount, row.GroupsItemSize, row.RoundTotalTo, row.RoundItemTo,
            row.FastSaving, row.CollectivePrinting, row.DisplayArticleQuantity,
            row.TerminalCount, row.OnlineTerminals, row.TodayReceipts, row.TodaySales,
            cashBoxList, terminals);
    }

    public async Task<SectionSaveResponse> CreateAsync(CreateSectionRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Name))
            throw new InvalidOperationException("اسم القسم مطلوب");

        var boxes = NormalizeAssignments(req.CashBoxes);
        if (boxes.Count == 0)
            throw new InvalidOperationException("أضف صندوقاً واحداً على الأقل");

        var edariResult = await edariPush.PushCreateAsync(req with { CashBoxes = boxes }, ct);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var branchId = req.BranchId ?? await ResolveBranchIdAsync(conn, edariResult.EdariBranchSeq, req.Name.Trim(), ct);

        var sectionId = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO sections (name, branch_id, state, sell_price, edari_branch_id, edari_warehouse_number)
            OUTPUT INSERTED.id
            VALUES (@name, @branchId, @state, @sellPrice, @edariBranchId, @edariWarehouseNumber)
            """, new
        {
            name = req.Name.Trim(),
            branchId,
            state = req.State ? 1 : 0,
            sellPrice = req.SellPrice,
            edariBranchId = edariResult.EdariBranchSeq,
            edariWarehouseNumber = req.EdariWarehouseNumber
        }, cancellationToken: ct));

        await ReplaceCashBoxesAsync(conn, sectionId, boxes, ct);
        await UpsertLocalBranchNameAsync(conn, branchId, req.Name.Trim(), ct);
        return new SectionSaveResponse(sectionId, edariResult.EdariBranchSeq, edariResult.Message);
    }

    public async Task<SectionSaveResponse> UpdateAsync(long id, UpdateSectionRequest req, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        IReadOnlyList<SectionCashBoxAssignment> boxesForEdari;
        if (req.CashBoxes is not null)
        {
            var boxes = NormalizeAssignments(req.CashBoxes);
            if (boxes.Count == 0)
                throw new InvalidOperationException("أضف صندوقاً واحداً على الأقل");
            boxesForEdari = boxes;
        }
        else
        {
            var existing = await GetCashBoxesAsync(id, ct);
            boxesForEdari = existing.Select(b =>
                new SectionCashBoxAssignment(b.MasterAccount, b.MasterAccountBank, b.IsDefault)).ToList();
        }

        var edariResult = await edariPush.PushUpdateAsync(
            req.EdariBranchId, req.Name, req.EdariSymbol, boxesForEdari, ct);

        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE sections SET
                name = @Name, state = @State, sell_price = @SellPrice,
                edari_branch_id = @EdariBranchId, edari_warehouse_number = @EdariWarehouseNumber,
                groups_columns_count = @GroupsColumnsCount, groups_item_size = @GroupsItemSize,
                round_total_to = @RoundTotalTo, round_item_to = @RoundItemTo,
                fast_saving = @FastSaving, collective_printing = @CollectivePrinting,
                display_article_quantity = @DisplayArticleQuantity
            WHERE id = @id
            """, new
        {
            id,
            req.Name, req.State, req.SellPrice,
            req.EdariBranchId, req.EdariWarehouseNumber,
            req.GroupsColumnsCount, req.GroupsItemSize, req.RoundTotalTo, req.RoundItemTo,
            req.FastSaving, req.CollectivePrinting, req.DisplayArticleQuantity
        }, cancellationToken: ct));

        if (req.CashBoxes is not null)
            await ReplaceCashBoxesAsync(conn, id, NormalizeAssignments(req.CashBoxes), ct);

        var branchId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT branch_id FROM sections WHERE id = @id", new { id }, cancellationToken: ct));
        if (branchId.HasValue)
            await UpsertLocalBranchNameAsync(conn, branchId.Value, req.Name.Trim(), ct);

        return new SectionSaveResponse(id, edariResult.EdariBranchSeq, edariResult.Message);
    }

    public async Task DeleteAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);

        var section = await conn.QuerySingleOrDefaultAsync<SectionDeleteRow>(new CommandDefinition("""
            SELECT id AS Id, name AS Name, edari_branch_id AS EdariBranchId
            FROM sections WHERE id = @id
            """, new { id }, cancellationToken: ct));
        if (section is null)
            throw new InvalidOperationException("نقطة البيع غير موجودة");

        var cashierCount = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM cashiers WHERE section_id = @id",
            new { id }, cancellationToken: ct));
        if (cashierCount > 0)
            throw new InvalidOperationException($"لا يمكن الحذف — يوجد {cashierCount} كاشير مرتبط بهذه النقطة");

        var terminalCount = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT COUNT(*) FROM point_of_sales
            WHERE section_id = @id AND COALESCE(is_deleted, 0) = 0
            """, new { id }, cancellationToken: ct));
        if (terminalCount > 0)
            throw new InvalidOperationException($"لا يمكن الحذف — يوجد {terminalCount} جهاز POS مرتبط");

        var receiptCount = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT COUNT(*)
            FROM reciepts r
            INNER JOIN point_of_sales p ON p.id = r.point_of_sale_id
            WHERE p.section_id = @id
            """, new { id }, cancellationToken: ct));
        if (receiptCount > 0)
            throw new InvalidOperationException($"لا يمكن الحذف — توجد {receiptCount} فاتورة مرتبطة");

        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM sections WHERE id = @id",
            new { id }, cancellationToken: ct));

        if (section.EdariBranchId > 0)
        {
            var otherSections = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM sections WHERE edari_branch_id = @seq",
                new { seq = section.EdariBranchId }, cancellationToken: ct));
            if (otherSections == 0)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "DELETE FROM edari_branches WHERE erp_seq = @seq",
                    new { seq = section.EdariBranchId }, cancellationToken: ct));
            }
        }
    }

    public async Task<IReadOnlyList<SectionCashBoxDto>> GetCashBoxesAsync(long sectionId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<CashBoxRow>(new CommandDefinition("""
            SELECT master_account AS MasterAccount, master_account_bank AS MasterAccountBank,
                   CAST(is_default AS bit) AS IsDefault
            FROM section_cashboxes
            WHERE section_id = @sectionId
            ORDER BY is_default DESC, sort_order, id
            """, new { sectionId }, cancellationToken: ct))).ToList();
        return await EnrichCashBoxesAsync(rows, ct);
    }

    public async Task<IReadOnlyList<SectionCashBoxDto>> GetCashBoxesForCashierAsync(long cashierId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var sectionId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT section_id FROM cashiers WHERE id = @id", new { id = cashierId }, cancellationToken: ct));
        if (!sectionId.HasValue || sectionId.Value <= 0) return [];
        return await GetCashBoxesAsync(sectionId.Value, ct);
    }

    public async Task<bool> ValidateCashBoxForCashierAsync(long cashierId, long masterAccount, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var count = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT COUNT(*)
            FROM section_cashboxes sc
            INNER JOIN cashiers c ON c.section_id = sc.section_id
            WHERE c.id = @cashierId AND sc.master_account = @masterAccount
            """, new { cashierId, masterAccount }, cancellationToken: ct));
        return count > 0;
    }

    public async Task<long?> GetCashierSectionIdAsync(long cashierId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT section_id FROM cashiers WHERE id = @id", new { id = cashierId }, cancellationToken: ct));
    }

    public async Task<string?> GetSectionNameAsync(long sectionId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT name FROM sections WHERE id = @id", new { id = sectionId }, cancellationToken: ct));
    }

    private static async Task UpsertLocalBranchNameAsync(System.Data.Common.DbConnection conn, long branchId, string name, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE branches SET name = @name WHERE id = @id",
            new { id = branchId, name }, cancellationToken: ct));
    }

    private async Task ReplaceCashBoxesAsync(System.Data.Common.DbConnection conn, long sectionId,
        IReadOnlyList<SectionCashBoxAssignment> boxes, CancellationToken ct)
    {
        await conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM section_cashboxes WHERE section_id = @sectionId",
            new { sectionId }, cancellationToken: ct));

        var order = 0;
        foreach (var box in boxes)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO section_cashboxes (section_id, master_account, master_account_bank, is_default, sort_order)
                VALUES (@sectionId, @masterAccount, @masterAccountBank, @isDefault, @sortOrder)
                """, new
            {
                sectionId,
                masterAccount = box.MasterAccount,
                masterAccountBank = box.MasterAccountBank ?? 0,
                isDefault = box.IsDefault ? 1 : 0,
                sortOrder = order++
            }, cancellationToken: ct));
        }

        var defaultBox = boxes.FirstOrDefault(b => b.IsDefault) ?? boxes[0];
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE sections SET master_account = @masterAccount, master_account_bank = @masterAccountBank
            WHERE id = @sectionId
            """, new
        {
            sectionId,
            masterAccount = defaultBox.MasterAccount,
            masterAccountBank = defaultBox.MasterAccountBank ?? 0
        }, cancellationToken: ct));
    }

    private static List<SectionCashBoxAssignment> NormalizeAssignments(IReadOnlyList<SectionCashBoxAssignment>? boxes)
    {
        if (boxes is null || boxes.Count == 0) return [];
        var distinct = boxes
            .Where(b => b.MasterAccount > 0)
            .GroupBy(b => b.MasterAccount)
            .Select(g => g.First())
            .ToList();
        if (distinct.Count == 0) return [];
        if (distinct.All(b => !b.IsDefault))
            distinct[0] = distinct[0] with { IsDefault = true };
        else if (distinct.Count(b => b.IsDefault) > 1)
        {
            var firstDefault = true;
            distinct = distinct.Select(b =>
            {
                if (!b.IsDefault) return b;
                if (firstDefault) { firstDefault = false; return b; }
                return b with { IsDefault = false };
            }).ToList();
        }
        return distinct;
    }

    private async Task<IReadOnlyList<SectionCashBoxDto>> EnrichCashBoxesAsync(IList<CashBoxRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return [];
        var seqs = rows.Select(r => r.MasterAccount).Distinct().ToList();
        var accounts = await cashBoxes.LookupBySeqsAsync(seqs, ct);
        var map = accounts.ToDictionary(a => a.Seq);
        return rows.Select(r =>
        {
            map.TryGetValue(r.MasterAccount, out var acc);
            return new SectionCashBoxDto(
                r.MasterAccount, r.MasterAccountBank,
                acc?.Name, acc?.Num, r.IsDefault);
        }).ToList();
    }

    private static async Task<IReadOnlyList<PosTerminalDto>> GetTerminalsAsync(
        System.Data.Common.DbConnection conn, long sectionId, CancellationToken ct)
    {
        const string terminalsSql = """
            SELECT p.id AS Id, p.name AS Name, p.hw_id AS HwId, p.section_id AS SectionId,
                   s.name AS SectionName,
                   p.last_connection AS LastConnection,
                   p.exe_version AS ExeVersion, CAST(p.state AS bit) AS Active
            FROM point_of_sales p
            LEFT JOIN sections s ON s.id = p.section_id
            WHERE p.section_id = @id AND COALESCE(p.is_deleted, 0) = 0
            ORDER BY p.name
            """;
        var rows = (await conn.QueryAsync<SectionTerminalRow>(new CommandDefinition(
            terminalsSql, new { id = sectionId }, cancellationToken: ct))).ToList();
        return rows.Select(r => new PosTerminalDto(
            r.Id, r.Name, r.HwId, r.SectionId, r.SectionName,
            0, 0, null, null,
            r.LastConnection, r.ExeVersion, r.Active)).ToList();
    }

    private async Task<long> ResolveBranchIdAsync(System.Data.Common.DbConnection conn, int edariBranchId, string name, CancellationToken ct)
    {
        var branchId = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            """
            SELECT TOP 1 b.id FROM branches b
            INNER JOIN sections s ON s.branch_id = b.id
            WHERE s.edari_branch_id = @edariSeq
            """,
            new { edariSeq = edariBranchId }, cancellationToken: ct));
        if (branchId.HasValue) return branchId.Value;

        return await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO branches (name, state)
            OUTPUT INSERTED.id
            VALUES (@name, 1)
            """, new { name }, cancellationToken: ct));
    }

    private sealed class SectionDetailRow
    {
        public long Id { get; set; }
        public string Name { get; set; } = "";
        public long BranchId { get; set; }
        public string? BranchName { get; set; }
        public bool State { get; set; }
        public int SellPrice { get; set; }
        public int EdariBranchId { get; set; }
        public int EdariWarehouseNumber { get; set; }
        public int GroupsColumnsCount { get; set; }
        public int GroupsItemSize { get; set; }
        public double RoundTotalTo { get; set; }
        public double RoundItemTo { get; set; }
        public bool FastSaving { get; set; }
        public bool CollectivePrinting { get; set; }
        public bool DisplayArticleQuantity { get; set; }
        public int TerminalCount { get; set; }
        public int OnlineTerminals { get; set; }
        public int TodayReceipts { get; set; }
        public decimal TodaySales { get; set; }
    }

    private sealed class CashBoxRow
    {
        public long MasterAccount { get; set; }
        public int MasterAccountBank { get; set; }
        public bool IsDefault { get; set; }
    }

    private sealed class SectionDeleteRow
    {
        public long Id { get; set; }
        public string Name { get; set; } = "";
        public int EdariBranchId { get; set; }
    }

    private sealed class SectionTerminalRow
    {
        public long Id { get; set; }
        public string? Name { get; set; }
        public string? HwId { get; set; }
        public long? SectionId { get; set; }
        public string? SectionName { get; set; }
        public DateTime? LastConnection { get; set; }
        public string? ExeVersion { get; set; }
        public bool Active { get; set; }
    }
}
