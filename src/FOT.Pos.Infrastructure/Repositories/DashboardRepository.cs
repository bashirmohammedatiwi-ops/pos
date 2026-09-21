using Dapper;
using FOT.Pos.Infrastructure.Edari;
using FOT.Pos.Infrastructure.Services;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class DashboardRepository(
    ISqlConnectionFactory db,
    EdariDashboardCache edariCache,
    EdariSettingsService edariSettings)
{
    public async Task<DashboardStatsDto> GetStatsAsync(CancellationToken ct)
    {
        const string countsSql = """
            SELECT
                (SELECT COUNT(*) FROM offers WHERE enabled = 1) AS ActiveOffers,
                (SELECT COUNT(*) FROM articles WHERE COALESCE(SellPr4, 0) > 0) AS LocalProducts,
                (SELECT COUNT(*) FROM sections) AS LocalSections
            """;

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var opts = await edariSettings.GetEffectiveAsync(ct);
        var counts = await conn.QuerySingleAsync<(int ActiveOffers, int LocalProducts, int LocalSections)>(
            new CommandDefinition(countsSql, cancellationToken: ct));

        if (!opts.Enabled)
        {
            return new DashboardStatsDto(
                counts.ActiveOffers, 0, 0, 0, 0, counts.LocalProducts, counts.LocalSections, opts.DatabaseAlias, false,
                "تكامل الإداري معطّل — فعّله من إعدادات Edari.");
        }

        try
        {
            var stats = await edariCache.GetStatsAsync(ct);
            return new DashboardStatsDto(
                counts.ActiveOffers,
                stats.Materials,
                stats.TreeFolders,
                stats.Salesmen,
                stats.Branches,
                counts.LocalProducts,
                counts.LocalSections,
                opts.DatabaseAlias,
                true,
                null);
        }
        catch (Exception ex)
        {
            return new DashboardStatsDto(
                counts.ActiveOffers, 0, 0, 0, 0, counts.LocalProducts, counts.LocalSections, opts.DatabaseAlias, false,
                EdariNexusClient.FormatConnectionError(ex));
        }
    }

    public async Task<IReadOnlyList<ReceiptSummaryDto>> RecentReceiptsAsync(int limit, CancellationToken ct)
    {
        const string sql = """
            SELECT TOP (@limit) r.id AS Id, r.number AS Number, r.creation_date AS CreationDate,
                   CAST(r.total_amount AS DECIMAL(18,2)) AS TotalAmount,
                   CAST(r.payment AS DECIMAL(18,2)) AS Payment,
                   CAST(r.cash_back AS DECIMAL(18,2)) AS CashBack,
                   r.salesman AS SalesmanId, sm.name AS SalesmanName,
                   r.point_of_sale_id AS PosId, p.name AS PosName,
                   CAST(r.synced AS bit) AS Synced, r.edr_num AS EdrNum,
                   (SELECT COUNT(*) FROM reciept_items ri WHERE ri.reciept_id = r.id) AS ItemCount
            FROM reciepts r
            LEFT JOIN salesmen sm ON sm.id = r.salesman
            LEFT JOIN point_of_sales p ON p.id = r.point_of_sale_id
            WHERE COALESCE(r.is_pending, 0) = 0
            ORDER BY r.id DESC
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<RecentReceiptRow>(
            new CommandDefinition(sql, new { limit }, cancellationToken: ct))).ToList();
        return rows.Select(r => new ReceiptSummaryDto(
            r.Id, r.Number, r.CreationDate, r.TotalAmount, r.Payment, r.CashBack,
            r.SalesmanId, r.SalesmanName, r.PosId, r.PosName, r.Synced, r.EdrNum, r.ItemCount)).ToList();
    }

    public async Task<IReadOnlyList<PosTerminalDto>> TerminalsAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT p.id AS Id, p.name AS Name, p.hw_id AS HwId, p.section_id AS SectionId,
                   s.name AS SectionName,
                   p.last_connection AS LastConnection,
                   p.exe_version AS ExeVersion, CAST(p.state AS bit) AS Active
            FROM point_of_sales p LEFT JOIN sections s ON s.id = p.section_id
            WHERE COALESCE(p.is_deleted,0)=0 ORDER BY p.name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<DashboardTerminalRow>(
            new CommandDefinition(sql, cancellationToken: ct))).ToList();
        return rows.Select(r => new PosTerminalDto(
            r.Id, r.Name, r.HwId, r.SectionId, r.SectionName,
            0, 0, null, null, r.LastConnection, r.ExeVersion, r.Active)).ToList();
    }

    public async Task<PagedResult<SalesmanDto>> SalesmenAsync(int page, int pageSize, bool activeOnly, bool includeAll, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var where = activeOnly
            ? $"WHERE {SalesmanQueries.ActiveWhere}"
            : includeAll
                ? "WHERE sm.name IS NOT NULL AND LTRIM(RTRIM(sm.name)) <> N''"
                : $"WHERE {await SalesmanQueries.EdariFilterWhereAsync(conn, ct)}";
        var orderBy = await SalesmanQueries.OrderByAsync(conn, ct);
        var sql = $"""
            SELECT sm.id AS Id,
                   COALESCE(NULLIF(LTRIM(RTRIM(sm.name)), N''), CONCAT(CAST(sm.id AS NVARCHAR(20)), N'-')) AS Name
            FROM salesmen sm
            {where}
            ORDER BY {orderBy}
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
            SELECT COUNT(*) FROM salesmen sm {where};
            """;
        using var multi = await conn.QueryMultipleAsync(new CommandDefinition(
            sql, new { offset = (page - 1) * pageSize, pageSize }, cancellationToken: ct));
        var items = (await multi.ReadAsync<SalesmanDto>()).ToList();
        var total = await multi.ReadSingleAsync<int>();
        return new PagedResult<SalesmanDto>(items, total, page, pageSize);
    }

    public async Task<IReadOnlyList<SectionDto>> SectionsAsync(CancellationToken ct)
    {
        const string sql = "SELECT id AS Id, name AS Name, branch_id AS BranchId, CAST(state AS bit) AS State, sell_price AS SellPrice FROM sections ORDER BY name";
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return (await conn.QueryRowsAsync<SectionDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    private sealed class RecentReceiptRow
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
    }

    private sealed class DashboardTerminalRow
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
