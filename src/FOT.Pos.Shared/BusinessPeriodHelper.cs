namespace FOT.Pos.Shared;

/// <summary>
/// Calendar helpers for business weeks (e.g. Saturday–Friday) and months.
/// Day-of-week matches .NET/JavaScript: Sunday=0 … Saturday=6.
/// </summary>
public static class BusinessPeriodHelper
{
    public const int DefaultWeekStartDay = 6;
    public const int DefaultWeekLengthDays = 7;

    public static (DateTime Start, DateTime EndInclusive) GetWeekBounds(
        DateTime date, int weekStartDay = DefaultWeekStartDay, int weekLengthDays = DefaultWeekLengthDays)
    {
        var d = date.Date;
        var offset = ((int)d.DayOfWeek - weekStartDay + 7) % 7;
        var start = d.AddDays(-offset);
        var end = start.AddDays(weekLengthDays - 1);
        return (start, end);
    }

    public static (DateTime Start, DateTime EndInclusive) GetCurrentWeek(
        int weekStartDay = DefaultWeekStartDay, int weekLengthDays = DefaultWeekLengthDays) =>
        GetWeekBounds(DateTime.Today, weekStartDay, weekLengthDays);

    public static (DateTime Start, DateTime EndInclusive) GetPreviousWeek(
        int weekStartDay = DefaultWeekStartDay, int weekLengthDays = DefaultWeekLengthDays)
    {
        var (start, _) = GetCurrentWeek(weekStartDay, weekLengthDays);
        return (start.AddDays(-weekLengthDays), start.AddDays(-1));
    }

    public static (DateTime Start, DateTime EndInclusive) GetMonthBounds(DateTime date)
    {
        var start = new DateTime(date.Year, date.Month, 1);
        var end = start.AddMonths(1).AddDays(-1);
        return (start, end);
    }

    public static int CountCalendarDays(DateTime periodStart, DateTime periodEndExclusive) =>
        Math.Max(1, (int)(periodEndExclusive.Date - periodStart.Date).TotalDays);

    public static int CountBusinessWeeks(
        DateTime periodStart, DateTime periodEndExclusive, int weekStartDay, int weekLengthDays)
    {
        var endInclusive = periodEndExclusive.Date.AddDays(-1);
        if (endInclusive < periodStart.Date) return 0;

        var (firstStart, _) = GetWeekBounds(periodStart, weekStartDay, weekLengthDays);
        var count = 0;
        for (var ws = firstStart; ws <= endInclusive; ws = ws.AddDays(weekLengthDays))
        {
            var we = ws.AddDays(weekLengthDays - 1);
            if (we >= periodStart.Date && ws <= endInclusive)
                count++;
        }
        return count;
    }

    public static int CountCalendarMonths(DateTime periodStart, DateTime periodEndExclusive)
    {
        var endInclusive = periodEndExclusive.Date.AddDays(-1);
        if (endInclusive < periodStart.Date) return 0;

        var count = 0;
        var cursor = new DateTime(periodStart.Year, periodStart.Month, 1);
        while (cursor <= endInclusive)
        {
            var monthEnd = cursor.AddMonths(1).AddDays(-1);
            if (monthEnd >= periodStart.Date && cursor <= endInclusive)
                count++;
            cursor = cursor.AddMonths(1);
        }
        return count;
    }

    public static bool IsSingleBusinessWeek(
        DateTime periodStart, DateTime periodEndExclusive, int weekStartDay, int weekLengthDays)
    {
        var endInclusive = periodEndExclusive.Date.AddDays(-1);
        var (ws, we) = GetWeekBounds(periodStart, weekStartDay, weekLengthDays);
        return periodStart.Date == ws && endInclusive == we;
    }

    public static bool IsSingleCalendarMonth(DateTime periodStart, DateTime periodEndExclusive)
    {
        var endInclusive = periodEndExclusive.Date.AddDays(-1);
        var (ms, me) = GetMonthBounds(periodStart);
        return periodStart.Date == ms && endInclusive == me;
    }

    public static bool IsSingleDay(DateTime periodStart, DateTime periodEndExclusive) =>
        CountCalendarDays(periodStart, periodEndExclusive) == 1;

    public static int WeekEndDay(int weekStartDay, int weekLengthDays) =>
        (weekStartDay + weekLengthDays - 1) % 7;

    public static string DayNameAr(int dayOfWeek) => dayOfWeek switch
    {
        0 => "الأحد",
        1 => "الإثنين",
        2 => "الثلاثاء",
        3 => "الأربعاء",
        4 => "الخميس",
        5 => "الجمعة",
        6 => "السبت",
        _ => "—"
    };
}
