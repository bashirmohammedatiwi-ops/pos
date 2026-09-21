using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class BusinessPeriodSettingsRepository(ISqlConnectionFactory db)
{
    private const string SelectSql = """
        SELECT
            week_start_day AS WeekStartDay,
            week_length_days AS WeekLengthDays
        FROM ext_business_period_settings
        WHERE id = 1
        """;

    public async Task<BusinessPeriodSettingsDto> GetAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        try
        {
            var row = await conn.QueryRowOrDefaultAsync<BusinessPeriodRow>(
                new CommandDefinition(SelectSql, cancellationToken: ct));
            return BuildDto(row?.WeekStartDay ?? BusinessPeriodHelper.DefaultWeekStartDay,
                row?.WeekLengthDays ?? BusinessPeriodHelper.DefaultWeekLengthDays);
        }
        catch
        {
            return BuildDto(BusinessPeriodHelper.DefaultWeekStartDay, BusinessPeriodHelper.DefaultWeekLengthDays);
        }
    }

    public async Task<BusinessPeriodSettingsDto> SaveAsync(UpdateBusinessPeriodSettingsRequest req, CancellationToken ct)
    {
        var weekStart = Math.Clamp(req.WeekStartDay, 0, 6);
        var weekLength = Math.Clamp(req.WeekLengthDays, 1, 14);

        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_business_period_settings SET
                week_start_day = @WeekStartDay,
                week_length_days = @WeekLengthDays,
                updated_at = GETDATE()
            WHERE id = 1
            """, new { WeekStartDay = weekStart, WeekLengthDays = weekLength }, cancellationToken: ct));

        return await GetAsync(ct);
    }

    private static BusinessPeriodSettingsDto BuildDto(int weekStartDay, int weekLengthDays)
    {
        var (curStart, curEnd) = BusinessPeriodHelper.GetCurrentWeek(weekStartDay, weekLengthDays);
        var (prevStart, prevEnd) = BusinessPeriodHelper.GetPreviousWeek(weekStartDay, weekLengthDays);
        var (monthStart, monthEnd) = BusinessPeriodHelper.GetMonthBounds(DateTime.Today);
        var weekEndDay = BusinessPeriodHelper.WeekEndDay(weekStartDay, weekLengthDays);

        return new BusinessPeriodSettingsDto(
            weekStartDay,
            weekLengthDays,
            BusinessPeriodHelper.DayNameAr(weekStartDay),
            BusinessPeriodHelper.DayNameAr(weekEndDay),
            curStart,
            curEnd,
            prevStart,
            prevEnd,
            monthStart,
            monthEnd);
    }

    private sealed class BusinessPeriodRow
    {
        public int WeekStartDay { get; set; }
        public int WeekLengthDays { get; set; }
    }
}
