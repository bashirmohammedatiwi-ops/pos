namespace FOT.Pos.Infrastructure.Edari;

public sealed partial class EdariNexusClient
{
    public async Task<long> CreateBranchAsync(string name, string? symbol, long cashAcc, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        await using var maxCmd = conn.CreateEdariCommand();
        maxCmd.CommandText = "SELECT COALESCE(MAX(Seq), 0) FROM FileBrch";
        var maxSeq = Convert.ToInt64(await maxCmd.ExecuteScalarAsync(ct) ?? 0);
        var newSeq = maxSeq + 1;

        var templateSeq = await FindBranchTemplateSeqAsync(conn, ct);
        var sql = $"""
            INSERT INTO FileBrch (
                Seq, Name, Symbol, SaleAcc, UnSaleAcc, OutAcc, CashAcc, DscntAcc,
                OmAcc, PersonAcc, OmPercent, Mst, Present, Book, FWorkTime,
                OutOnly, Extra1, Extra2, Extra3, Extra4, Extra5, Extra6)
            SELECT
                {EdariSql.Long(newSeq)}, {EdariSql.Str(name)}, {EdariSql.Str(symbol ?? "")},
                SaleAcc, UnSaleAcc, OutAcc, {EdariSql.Long(cashAcc)}, DscntAcc,
                OmAcc, PersonAcc, OmPercent, Mst, Present, Book, FWorkTime,
                OutOnly, Extra1, Extra2, Extra3, Extra4, Extra5, Extra6
            FROM FileBrch
            WHERE Seq = {EdariSql.Long(templateSeq)}
            """;
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync(ct);
        await EnsureBranchPostingAccountsAsync(conn, newSeq, ct);
        return newSeq;
    }

    public async Task UpdateBranchAsync(long seq, string name, string? symbol, long cashAcc, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        var sql = $"""
            UPDATE FileBrch SET
                Name = {EdariSql.Str(name)},
                Symbol = {EdariSql.Str(symbol ?? "")},
                CashAcc = {EdariSql.Long(cashAcc)}
            WHERE Seq = {EdariSql.Long(seq)}
            """;
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = sql;
        var affected = await cmd.ExecuteNonQueryAsync(ct);
        if (affected == 0)
            throw new InvalidOperationException($"فرع Edari #{seq} غير موجود");

        await EnsureBranchPostingAccountsAsync(conn, seq, ct);
    }

    /// <summary>
    /// POS «دمج الإيصالات» needs SaleAcc/UnSaleAcc/OutAcc/DscntAcc/Present on FileBrch.
    /// Branches created with only CashAcc stay at zero and merge closes FilePOS5 without posting to the cash box.
    /// </summary>
    public async Task EnsureBranchPostingAccountsAsync(long branchSeq, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        await EnsureBranchPostingAccountsAsync(conn, branchSeq, ct);
    }

    private static async Task EnsureBranchPostingAccountsAsync(
        System.Data.Common.DbConnection conn, long branchSeq, CancellationToken ct)
    {
        await using var check = conn.CreateEdariCommand();
        check.CommandText = $"""
            SELECT SaleAcc, UnSaleAcc, OutAcc, DscntAcc, Present
            FROM FileBrch
            WHERE Seq = {EdariSql.Long(branchSeq)}
            """;
        await using var reader = await check.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
            return;

        var saleAcc = ReadAccount(reader, 0);
        var unSaleAcc = ReadAccount(reader, 1);
        var outAcc = ReadAccount(reader, 2);
        var dscntAcc = ReadAccount(reader, 3);
        var present = ReadAccount(reader, 4);
        if (saleAcc > 0 && unSaleAcc > 0 && outAcc > 0 && dscntAcc > 0 && present > 0)
            return;

        await reader.CloseAsync();

        var templateSeq = await FindBranchTemplateSeqAsync(conn, ct);
        await using var fix = conn.CreateEdariCommand();
        fix.CommandText = $"""
            UPDATE FileBrch SET
                SaleAcc = (SELECT SaleAcc FROM FileBrch WHERE Seq = {EdariSql.Long(templateSeq)}),
                UnSaleAcc = (SELECT UnSaleAcc FROM FileBrch WHERE Seq = {EdariSql.Long(templateSeq)}),
                OutAcc = (SELECT OutAcc FROM FileBrch WHERE Seq = {EdariSql.Long(templateSeq)}),
                DscntAcc = (SELECT DscntAcc FROM FileBrch WHERE Seq = {EdariSql.Long(templateSeq)}),
                Present = CASE WHEN Present = 0 THEN (SELECT Present FROM FileBrch WHERE Seq = {EdariSql.Long(templateSeq)}) ELSE Present END
            WHERE Seq = {EdariSql.Long(branchSeq)}
              AND (SaleAcc = 0 OR UnSaleAcc = 0 OR OutAcc = 0 OR DscntAcc = 0 OR Present = 0)
            """;
        await fix.ExecuteNonQueryAsync(ct);
    }

    /// <summary>
    /// Returns an Arabic description of why «دمج الإيصالات» cannot post this branch to a cash box, or null when it can.
    /// CashAcc is branch-specific so it can never be filled from a template — it has to be set on the section.
    /// </summary>
    public async Task<string?> DescribeBranchPostingProblemAsync(long branchSeq, CancellationToken ct)
    {
        await using var conn = await connections.CreateOpenConnectionAsync(ct);
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = $"""
            SELECT Name, SaleAcc, UnSaleAcc, DscntAcc, CashAcc, Present
            FROM FileBrch
            WHERE Seq = {EdariSql.Long(branchSeq)}
            """;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
            return $"فرع Edari #{branchSeq} غير موجود — نفّذ «مزامنة الفروع» أو صحّح ربط القسم";

        var name = reader.IsDBNull(0) ? "" : reader.GetString(0).Trim();
        var missing = new List<string>();
        if (ReadAccount(reader, 4) <= 0) missing.Add("الصندوق (CashAcc)");
        if (ReadAccount(reader, 1) <= 0) missing.Add("حساب المبيعات (SaleAcc)");
        if (ReadAccount(reader, 2) <= 0) missing.Add("حساب مردودات المبيعات (UnSaleAcc)");
        if (ReadAccount(reader, 3) <= 0) missing.Add("حساب الحسم (DscntAcc)");
        if (ReadAccount(reader, 5) <= 0) missing.Add("حساب الهدايا (Present)");
        if (missing.Count == 0)
            return null;

        var label = name.Length == 0 ? $"#{branchSeq}" : $"#{branchSeq} ({name})";
        return $"فرع Edari {label}: غير مضبوط — {string.Join("، ", missing)}. "
             + "بدون ذلك يُغلق الدمج الإيصال دون تسجيله في كشف الصندوق. حدّد صندوق القسم من «الأقسام» ثم أعد الترحيل";
    }

    private static long ReadAccount(System.Data.Common.DbDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? 0L : Convert.ToInt64(reader.GetValue(ordinal));

    private static async Task<long> FindBranchTemplateSeqAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        await using var cmd = conn.CreateEdariCommand();
        cmd.CommandText = """
            SELECT TOP 1 Seq FROM FileBrch
            WHERE SaleAcc > 0 AND UnSaleAcc > 0 AND OutAcc > 0 AND DscntAcc > 0 AND Present > 0 AND CashAcc > 0
            ORDER BY Seq
            """;
        var result = await cmd.ExecuteScalarAsync(ct);
        if (result is null or DBNull)
        {
            cmd.CommandText = "SELECT TOP 1 Seq FROM FileBrch ORDER BY Seq";
            result = await cmd.ExecuteScalarAsync(ct);
        }
        return result is null or DBNull ? 1 : Convert.ToInt64(result);
    }
}
