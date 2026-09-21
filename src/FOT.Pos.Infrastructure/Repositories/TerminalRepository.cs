using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class TerminalRepository(ISqlConnectionFactory db)
{
    private const string SelectColumns = """
        p.id AS Id, p.name AS Name, p.hw_id AS HwId, p.section_id AS SectionId,
        s.name AS SectionName, p.last_connection AS LastConnection,
        p.last_sync AS LastSync, p.last_update AS LastUpdate,
        p.exe_version AS ExeVersion, CAST(p.state AS bit) AS Active
        """;

    public async Task<PosTerminalDto?> GetByHwIdAsync(string hwId, CancellationToken ct)
    {
        var sql = $"""
            SELECT {SelectColumns}
            FROM point_of_sales p LEFT JOIN sections s ON s.id = p.section_id
            WHERE p.hw_id = @hwId AND COALESCE(p.is_deleted,0)=0
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<TerminalRow>(
            new CommandDefinition(sql, new { hwId }, cancellationToken: ct));
        return row is null ? null : ToTerminalDto(row);
    }

    public async Task<bool> GetAllowOfflineModeAsync(long posId, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            return await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
                "SELECT CAST(COALESCE(allow_offline_mode, 1) AS bit) FROM point_of_sales WHERE id = @id",
                new { id = posId }, cancellationToken: ct));
        }
        catch
        {
            return true;
        }
    }

    public async Task<long> RegisterAsync(RegisterTerminalRequest req, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var existing = await conn.ExecuteScalarAsync<long?>(new CommandDefinition(
            "SELECT TOP 1 id FROM point_of_sales WHERE hw_id = @hwId ORDER BY COALESCE(is_deleted,0), id",
            new { hwId = req.HwId }, cancellationToken: ct));

        if (existing.HasValue)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE point_of_sales SET name=COALESCE(@name,name),
                    last_connection=GETDATE(), state=1, is_deleted=0 WHERE id=@id
                """, new { id = existing.Value, name = req.Name }, cancellationToken: ct));
            return existing.Value;
        }

        return await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO point_of_sales (name, hw_id, section_id, last_connection, state, is_deleted, exe_version)
            OUTPUT INSERTED.id
            VALUES (@name, @hwId, NULL, GETDATE(), 1, 0, '2.0')
            """, new { name = req.Name ?? req.HwId, hwId = req.HwId },
            cancellationToken: ct));
    }

    public async Task<IReadOnlyList<SectionTerminalGroupDto>> MonitorGroupsAsync(CancellationToken ct)
    {
        var sql = $"""
            SELECT {SelectColumns}
            FROM point_of_sales p
            LEFT JOIN sections s ON s.id = p.section_id
            WHERE COALESCE(p.is_deleted,0)=0
            ORDER BY p.name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<TerminalRow>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
        var onlineThreshold = DateTime.Now.AddMinutes(-5);

        var terminals = rows.Select(r =>
        {
            var online = r.LastConnection.HasValue && r.LastConnection.Value > onlineThreshold;
            var path = r.Name ?? r.HwId ?? "—";
            return new PosTerminalMonitorDto(
                r.Id, r.Name, r.HwId, null, null,
                0, 0, null, null,
                r.LastConnection, r.LastSync, r.LastUpdate, r.ExeVersion, r.Active, online, path);
        }).ToList();

        return
        [
            new SectionTerminalGroupDto(0, "الأجهزة",
                terminals.OrderByDescending(t => t.IsOnline).ThenBy(t => t.Name).ToList())
        ];
    }

    public async Task HeartbeatAsync(long id, string? exeVersion, CancellationToken ct) =>
        await HeartbeatAsync(id, exeVersion, null, null, ct);

    public async Task HeartbeatAsync(long id, string? exeVersion, int? pendingOffline, int? deadOffline, CancellationToken ct)
        => await HeartbeatAsync(id, exeVersion, pendingOffline, deadOffline, null, ct);

    /// <summary>Also records the terminal's offline-outbox health so the admin can see stuck terminals.</summary>
    public async Task HeartbeatAsync(
        long id, string? exeVersion, int? pendingOffline, int? deadOffline, int? deferredOffline, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            """
            UPDATE point_of_sales SET
                last_connection = GETDATE(),
                exe_version = COALESCE(@v, exe_version),
                pending_offline = COALESCE(@pending, pending_offline),
                dead_offline = COALESCE(@dead, dead_offline),
                deferred_offline = COALESCE(@deferred, deferred_offline)
            WHERE id = @id
            """,
            new { id, v = exeVersion, pending = pendingOffline, dead = deadOffline, deferred = deferredOffline },
            cancellationToken: ct));
    }

    public async Task<PosTerminalDetailDto?> GetDetailAsync(long id, CancellationToken ct)
    {
        var rows = await QueryDetailsAsync("p.id = @id AND COALESCE(p.is_deleted, 0) = 0", new { id }, ct);
        return rows.FirstOrDefault();
    }

    public async Task<IReadOnlyList<PosTerminalDetailDto>> ListDetailsAsync(CancellationToken ct) =>
        await QueryDetailsAsync("COALESCE(p.is_deleted, 0) = 0", new { }, ct);

    public async Task UpdateAsync(long id, UpdateTerminalRequest req, CancellationToken ct)
    {
        const string sql = """
            UPDATE point_of_sales SET
                name = COALESCE(@Name, name),
                state = @Active,
                allow_offline_mode = @AllowOfflineMode,
                remarks = @Remarks,
                vfd_first_line = @VfdFirstLine,
                vfd_second_line = @VfdSecondLine,
                mpos_service = @MposService,
                mpos_com_port = @MposComPort
            WHERE id = @id AND COALESCE(is_deleted, 0) = 0
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(sql, new
        {
            id,
            req.Name,
            req.Active,
            req.AllowOfflineMode,
            req.Remarks,
            req.VfdFirstLine,
            req.VfdSecondLine,
            MposService = Blank(req.MposService),
            MposComPort = Blank(req.MposComPort)
        }, cancellationToken: ct));
    }

    public async Task DeleteAsync(long id, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            "UPDATE point_of_sales SET is_deleted = 1, state = 0 WHERE id = @id",
            new { id }, cancellationToken: ct));
    }

    private async Task<IReadOnlyList<PosTerminalDetailDto>> QueryDetailsAsync(
        string whereClause, object param, CancellationToken ct)
    {
        var sql = $"""
            SELECT p.id AS Id, p.name AS Name, p.hw_id AS HwId, p.section_id AS SectionId,
                   s.name AS SectionName, p.last_connection AS LastConnection,
                   p.last_sync AS LastSync, p.last_update AS LastUpdate,
                   p.exe_version AS ExeVersion, CAST(p.state AS bit) AS Active,
                   CAST(COALESCE(p.allow_offline_mode, 0) AS bit) AS AllowOfflineMode,
                   p.remarks AS Remarks, p.vfd_first_line AS VfdFirstLine, p.vfd_second_line AS VfdSecondLine,
                   p.mpos_service AS MposService, p.mpos_com_port AS MposComPort,
                   COALESCE(rs.TodayReceipts, 0) AS TodayReceipts,
                   COALESCE(rs.TodaySales, 0) AS TodaySales
            FROM point_of_sales p
            LEFT JOIN sections s ON s.id = p.section_id
            LEFT JOIN (
                SELECT point_of_sale_id AS PosId,
                       COUNT(*) AS TodayReceipts,
                       SUM(CAST(total_amount AS DECIMAL(18,2))) AS TodaySales
                FROM reciepts
                WHERE CAST(creation_date AS date) = CAST(GETDATE() AS date)
                  AND COALESCE(is_pending, 0) = 0
                GROUP BY point_of_sale_id
            ) rs ON rs.PosId = p.id
            WHERE {whereClause}
            ORDER BY p.name
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<DetailRow>(
            new CommandDefinition(sql, param, cancellationToken: ct))).ToList();

        var threshold = DateTime.Now.AddMinutes(-5);
        return rows.Select(r => new PosTerminalDetailDto(
            r.Id, r.Name, r.HwId, r.SectionId, r.SectionName,
            0, 0, null, null,
            r.LastConnection, r.LastSync, r.LastUpdate, r.ExeVersion, r.Active,
            r.LastConnection.HasValue && r.LastConnection.Value > threshold,
            r.AllowOfflineMode, r.Remarks, r.VfdFirstLine, r.VfdSecondLine,
            r.TodayReceipts, r.TodaySales, r.MposService, r.MposComPort)).ToList();
    }

    /// <summary>Card reader service the cashier machine should talk to, if any.</summary>
    public async Task<CardTerminalConfig?> GetCardTerminalConfigAsync(long posId, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<CardTerminalConfig>(new CommandDefinition(
            "SELECT mpos_service AS Service, mpos_com_port AS ComPort FROM point_of_sales WHERE id = @posId",
            new { posId }, cancellationToken: ct));
    }

    /// <summary>
    /// Every cashier PC that talks to a PAX A910S uses the same local vendor service
    /// the old FOT POS used (localhost:9092). Persist that default the first time the
    /// terminal signs in so the admin screen and the POS button stay in sync.
    /// </summary>
    public async Task<CardTerminalConfig> EnsureDefaultCardTerminalAsync(long posId, CancellationToken ct)
    {
        try
        {
            await using var conn = await db.CreateOpenConnectionAsync(ct);
            await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE point_of_sales
                SET mpos_service = 'localhost:9092'
                WHERE id = @posId AND (mpos_service IS NULL OR LTRIM(RTRIM(mpos_service)) = '')
                """, new { posId }, cancellationToken: ct));

            return await conn.QuerySingleAsync<CardTerminalConfig>(new CommandDefinition(
                "SELECT mpos_service AS Service, mpos_com_port AS ComPort FROM point_of_sales WHERE id = @posId",
                new { posId }, cancellationToken: ct));
        }
        catch
        {
            return new CardTerminalConfig { Service = "localhost:9092" };
        }
    }

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static PosTerminalDto ToTerminalDto(TerminalRow r) => new(
        r.Id, r.Name, r.HwId, r.SectionId, r.SectionName,
        0, 0, null, null,
        r.LastConnection, r.ExeVersion, r.Active);

    private class TerminalRow
    {
        public long Id { get; set; }
        public string? Name { get; set; }
        public string? HwId { get; set; }
        public long? SectionId { get; set; }
        public string? SectionName { get; set; }
        public DateTime? LastConnection { get; set; }
        public DateTime? LastSync { get; set; }
        public DateTime? LastUpdate { get; set; }
        public string? ExeVersion { get; set; }
        public bool Active { get; set; }
    }

    private sealed class DetailRow : TerminalRow
    {
        public bool AllowOfflineMode { get; set; }
        public string? Remarks { get; set; }
        public string? VfdFirstLine { get; set; }
        public string? VfdSecondLine { get; set; }
        public string? MposService { get; set; }
        public string? MposComPort { get; set; }
        public int TodayReceipts { get; set; }
        public decimal TodaySales { get; set; }
    }
}

public sealed class CardTerminalConfig
{
    public string? Service { get; set; }
    public string? ComPort { get; set; }
}
