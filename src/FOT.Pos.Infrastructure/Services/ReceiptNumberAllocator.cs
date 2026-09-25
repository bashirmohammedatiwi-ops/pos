using Dapper;
using FOT.Pos.Shared;
using FOT.Pos.Shared.Dtos;
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

    /// <summary>
    /// Advances the cashier sequence by <paramref name="count"/> and records the range as owned
    /// by <paramref name="hwId"/>. The terminal prints those numbers offline; adopt accepts them later.
    /// </summary>
    public async Task<ReserveReceiptNumbersResponse> ReserveBlockAsync(
        System.Data.Common.DbConnection conn,
        System.Data.Common.DbTransaction tx,
        long cashierId,
        int count,
        string? hwId,
        int clientSeq,
        CancellationToken ct)
    {
        if (count < 1) count = 1;
        if (count > 200) count = 200;

        var year = DateTime.Now.Year;
        var cashierCode = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT receipt_num FROM cashiers WITH (UPDLOCK, HOLDLOCK) WHERE id = @cashierId",
            new { cashierId }, transaction: tx, cancellationToken: ct));
        if (cashierCode <= 0)
            throw new InvalidOperationException("رقم الكاشير غير مهيأ — راجع إعدادات الكاشير في الإدارة");

        var lastSeq = await conn.ExecuteScalarAsync<int?>(new CommandDefinition("""
            SELECT last_seq FROM receipt_number_sequences WITH (UPDLOCK, HOLDLOCK)
            WHERE [year] = @year AND cashier_id = @cashierId
            """, new { year, cashierId }, transaction: tx, cancellationToken: ct));

        var floor = Math.Max(lastSeq ?? 0, Math.Max(0, clientSeq));
        var fromSeq = floor + 1;
        var throughSeq = floor + count;
        if (throughSeq > ReceiptNumberFormatter.MaxSequence)
            throw new InvalidOperationException("نفدت أرقام فواتير هذا الكاشير لهذه السنة");

        if (lastSeq is null)
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO receipt_number_sequences ([year], cashier_id, last_seq)
                VALUES (@year, @cashierId, @throughSeq)
                """, new { year, cashierId, throughSeq }, transaction: tx, cancellationToken: ct));
        }
        else
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE receipt_number_sequences
                SET last_seq = @throughSeq
                WHERE [year] = @year AND cashier_id = @cashierId
                """, new { year, cashierId, throughSeq }, transaction: tx, cancellationToken: ct));
        }

        await conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO receipt_number_leases ([year], cashier_id, from_seq, to_seq, hw_id)
            VALUES (@year, @cashierId, @fromSeq, @throughSeq, @hwId)
            """, new { year, cashierId, fromSeq, throughSeq, hwId }, transaction: tx, cancellationToken: ct));

        return new ReserveReceiptNumbersResponse(year, cashierCode, fromSeq, throughSeq);
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
        string? hwId,
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

        // Below the cursor: accept this terminal's reserved block, or a gap no lease owns.
        // Another terminal's unused block must not be stolen. The cursor is never moved backward.
        if (lastSeq is int current && seq < current)
        {
            string? owner;
            try
            {
                owner = await conn.ExecuteScalarAsync<string?>(new CommandDefinition("""
                    SELECT TOP 1 hw_id FROM receipt_number_leases WITH (UPDLOCK, HOLDLOCK)
                    WHERE [year] = @year AND cashier_id = @cashierId
                      AND from_seq <= @seq AND to_seq >= @seq
                    ORDER BY id DESC
                    """, new { year, cashierId, seq }, transaction: tx, cancellationToken: ct));
            }
            catch (SqlException ex) when (ex.Number is 208)
            {
                return null;
            }
            if (owner is null) return clientNumber.Value;
            if (!string.IsNullOrWhiteSpace(hwId) && string.Equals(owner, hwId, StringComparison.Ordinal))
                return clientNumber.Value;
            return null;
        }

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
