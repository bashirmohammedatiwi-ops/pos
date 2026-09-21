using System.Data.Common;
using System.Globalization;

namespace FOT.Pos.Infrastructure.Edari;

/// <summary>
/// Creates a command with the unified NexusDB timeout — a hung Edari server must fail
/// fast instead of blocking the calling request or background cycle indefinitely.
/// </summary>
public static class EdariConnectionCommandExtensions
{
    public static DbCommand CreateEdariCommand(this DbConnection connection)
    {
        var cmd = connection.CreateCommand();
        cmd.CommandTimeout = EdariCommandDefaults.CommandTimeoutSeconds;
        return cmd;
    }
}

/// <summary>NexusDB ADO provider does not support parameters reliably — use safe literals.</summary>
internal static class EdariSql
{
    public static string Long(long v) => v.ToString(CultureInfo.InvariantCulture);
    public static string Int(int v) => v.ToString(CultureInfo.InvariantCulture);
    public static string Double(double v) => v.ToString(CultureInfo.InvariantCulture);
    public static string Decimal(decimal v) => v.ToString(CultureInfo.InvariantCulture);

    public static string Str(string? v) =>
        v is null ? "NULL" : $"'{v.Replace("'", "''")}'";

    public static string DateTime(DateTime v) =>
        $"'{v:yyyy-MM-dd HH:mm:ss}'";

    /// <summary>Edari virtual_date is date-only at noon — INSERT only (UPDATE rejects literals).</summary>
    public static string VirtualDate(DateTime v) =>
        $"'{v.Date:yyyy-MM-dd} 12:00:00'";
}
