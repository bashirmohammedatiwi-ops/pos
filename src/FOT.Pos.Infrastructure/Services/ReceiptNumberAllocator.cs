using Dapper;
using FOT.Pos.Shared;
using Microsoft.Data.SqlClient;

namespace FOT.Pos.Infrastructure.Services;

public sealed class ReceiptNumberAllocator
{
    public async Task<long> AllocateAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        long cashierId,
        CancellationToken ct)
    {
        var year = DateTime.Now.Year;

        int cashierCode;
        try
        {
            cashierCode = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT receipt_num FROM cashiers WITH (UPDLOCK, HOLDLOCK) WHERE id = @cashierId",
                new { cashierId }, transaction: tx, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number is 207 or 208)
        {
            return await AllocateLegacyAsync(conn, tx, ct);
        }

        if (cashierCode <= 0)
            throw new InvalidOperationException("رقم الكاشير غير مهيأ — راجع إعدادات الكاشير في الإدارة");

        var seq = await conn.ExecuteScalarAsync<int?>(new CommandDefinition("""
            UPDATE receipt_number_sequences WITH (UPDLOCK, HOLDLOCK)
            SET last_seq = last_seq + 1
            OUTPUT INSERTED.last_seq
            WHERE [year] = @year AND cashier_id = @cashierId
            """, new { year, cashierId }, transaction: tx, cancellationToken: ct));

        if (seq is null or <= 0)
        {
            seq = 1;
            try
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO receipt_number_sequences ([year], cashier_id, last_seq)
                    VALUES (@year, @cashierId, @seq)
                    """, new { year, cashierId, seq }, transaction: tx, cancellationToken: ct));
            }
            catch (SqlException ex) when (ex.Number is 2627 or 2601)
            {
                seq = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
                    UPDATE receipt_number_sequences WITH (UPDLOCK, HOLDLOCK)
                    SET last_seq = last_seq + 1
                    OUTPUT INSERTED.last_seq
                    WHERE [year] = @year AND cashier_id = @cashierId
                    """, new { year, cashierId }, transaction: tx, cancellationToken: ct));
            }
        }

        return ReceiptNumberFormatter.Compose(year, cashierCode, seq.Value);
    }

    private static async Task<long> AllocateLegacyAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        CancellationToken ct)
    {
        var next = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            SELECT ISNULL(MAX(CASE WHEN number < 2000000000 THEN number ELSE 0 END), 0) + 1
            FROM reciepts WITH (UPDLOCK, HOLDLOCK)
            """, transaction: tx, cancellationToken: ct));
        return next <= 0 ? 1 : next;
    }

    /// <summary>
    /// Adopts a client-allocated receipt number (offline/deferred posting) when it matches this
    /// cashier's {year}{code}{seq} format, and pushes the server sequence forward so future
    /// allocations never collide with it. Returns null when the number cannot be adopted.
    /// </summary>
    public async Task<long?> AdoptClientNumberAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        long cashierId,
        long? clientNumber,
        CancellationToken ct)
    {
        if (clientNumber is not > 0) return null;

        var year = DateTime.Now.Year;

        int cashierCode;
        try
        {
            cashierCode = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT receipt_num FROM cashiers WITH (UPDLOCK, HOLDLOCK) WHERE id = @cashierId",
                new { cashierId }, transaction: tx, cancellationToken: ct));
        }
        catch (SqlException ex) when (ex.Number is 207 or 208)
        {
            return null; // legacy schema — fall back to server allocation
        }

        if (cashierCode <= 0) return null;

        if (!ReceiptNumberFormatter.TryDecompose(clientNumber.Value, out var parsedYear, out var parsedCode, out var seq) ||
            parsedYear != year ||
            parsedCode != cashierCode)
        {
            return null;
        }

        var lastSeq = await conn.ExecuteScalarAsync<int?>(new CommandDefinition("""
            SELECT last_seq FROM receipt_number_sequences WITH (UPDLOCK, HOLDLOCK)
            WHERE [year] = @year AND cashier_id = @cashierId
            """, new { year, cashierId }, transaction: tx, cancellationToken: ct));

        // A stale local counter (paper printed 172 after the server had already
        // handed out 173–234) must not be adopted — that is how the printed copy
        // and the control panel ended up with different numbers.
        if (lastSeq is int current && seq < current)
            return null;

        var updated = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE receipt_number_sequences WITH (UPDLOCK, HOLDLOCK)
            SET last_seq = @seq
            WHERE [year] = @year AND cashier_id = @cashierId AND last_seq < @seq
            """, new { year, cashierId, seq }, transaction: tx, cancellationToken: ct));

        if (updated == 0 && lastSeq is null)
        {
            try
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO receipt_number_sequences ([year], cashier_id, last_seq)
                    VALUES (@year, @cashierId, @seq)
                    """, new { year, cashierId, seq }, transaction: tx, cancellationToken: ct));
            }
            catch (SqlException ex) when (ex.Number is 2627 or 2601)
            {
                // Row created concurrently with an equal-or-higher sequence — nothing to do.
            }
        }

        return clientNumber.Value;
    }
}
