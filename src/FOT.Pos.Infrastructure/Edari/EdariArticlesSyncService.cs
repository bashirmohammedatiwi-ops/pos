using System.Data;

using Dapper;

using FOT.Pos.Infrastructure.Data;

using FOT.Pos.Infrastructure.Repositories;

using FOT.Pos.Infrastructure.Services;

using Microsoft.Data.SqlClient;



namespace FOT.Pos.Infrastructure.Edari;



public sealed class EdariArticlesSyncService(

    EdariNexusClient nexus,

    EdariSettingsService settings,

    ISqlConnectionFactory db,

    EdariSyncRepository syncRepo,

    EdariDashboardCache dashboardCache)

{

    private const int BatchSize = 1000;

    private const int InsertChunkSize = 200;



    public async Task<EdariArticlesSyncResult> SyncAsync(CancellationToken ct)

    {

        var opts = await settings.GetEffectiveAsync(ct);

        if (!opts.Enabled)

            return new EdariArticlesSyncResult(false, "تكامل الإداري معطّل", 0, 0, 0, DateTime.UtcNow);



        if (!EdariConnectionFactory.DataFolderExists(opts))

        {

            var msg = $"مجلد النسخة غير موجود: {opts.YearFolder}";

            await syncRepo.LogOperationAsync("articles_sync", "failed", msg, ct);

            return new EdariArticlesSyncResult(false, msg, 0, 0, 0, DateTime.UtcNow);

        }



        long cursor = 0;

        var added = 0;

        var updated = 0;

        var total = 0;

        var deleted = 0;

        var seenSeqs = new HashSet<long>();



        try

        {

            await using var conn = await db.CreateOpenConnectionAsync(ct);



            while (true)

            {

                IReadOnlyList<EdariMaterialRow> batch;

                try

                {

                    batch = await nexus.GetMaterialsBatchAsync(cursor, BatchSize, ct);

                }

                catch (Exception ex)

                {

                    throw new InvalidOperationException($"Edari batch @ {cursor}: {ex.Message}", ex);

                }



                if (batch.Count == 0) break;



                foreach (var r in batch) seenSeqs.Add(r.Seq);



                var rows = batch.Select(CloneRow).ToList();
                foreach (var row in rows)
                    row.Name1 = EdariStringHelper.PreferEdariProductName(row.Name1);



                var seqs = rows.Select(r => r.Seq).ToArray();

                var existing = (await conn.QueryAsync<long>(new CommandDefinition(

                    "SELECT Seq FROM articles WHERE Seq IN @seqs",

                    new { seqs }, cancellationToken: ct))).ToHashSet();



                var toInsert = rows.Where(r => !existing.Contains(r.Seq)).ToList();

                var toUpdate = rows.Where(r => existing.Contains(r.Seq)).ToList();



                if (toInsert.Count > 0)

                {

                    if (conn is SqlConnection sqlConn)

                        await BulkInsertArticlesAsync(sqlConn, toInsert, ct);

                    else

                        await InsertArticlesChunkedAsync(conn, toInsert, ct);

                }



                foreach (var row in toUpdate)

                {

                    updated += await conn.ExecuteAsync(new CommandDefinition("""

                        UPDATE articles SET

                            Num = @Num, Name1 = COALESCE(@Name1, Name1), Barcode = @Barcode, Father = @Father, Sub = @Sub,

                            SellPr4 = @SellPr4, SellPr5 = @SellPr5, CurTot1 = @CurTot1

                        WHERE Seq = @Seq

                          AND (

                            ISNULL(Num, N'') <> ISNULL(@Num, N'')

                            OR (@Name1 IS NOT NULL AND ISNULL(Name1, N'') <> ISNULL(@Name1, N''))

                            OR ISNULL(Barcode, N'') <> ISNULL(@Barcode, N'')

                            OR ISNULL(Father, 0) <> ISNULL(@Father, 0)

                            OR ISNULL(Sub, 0) <> ISNULL(@Sub, 0)

                            OR ISNULL(SellPr4, 0) <> ISNULL(@SellPr4, 0)

                            OR ISNULL(SellPr5, 0) <> ISNULL(@SellPr5, 0)

                            OR ISNULL(CurTot1, 0) <> ISNULL(@CurTot1, 0)

                          )

                        """, row, cancellationToken: ct));

                }



                added += toInsert.Count;

                total += batch.Count;

                cursor = batch[^1].Seq;

                if (batch.Count < BatchSize) break;

            }



            // Full pass complete — seenSeqs now holds every Seq currently in Edari's File13n.
            // Anything in the local mirror that wasn't seen this pass was removed on the Edari
            // side (deleted product/folder) and must be removed here too, otherwise deleted
            // items linger forever in the control panel (stock, trees, offers, reports).
            if (total > 0)
            {
                try
                {
                    var existingSeqs = (await conn.QueryAsync<long>(new CommandDefinition(
                        "SELECT Seq FROM articles", cancellationToken: ct))).ToList();
                    var toDelete = existingSeqs.Where(s => !seenSeqs.Contains(s)).ToList();

                    const int deleteChunkSize = 500;
                    for (var i = 0; i < toDelete.Count; i += deleteChunkSize)
                    {
                        var chunk = toDelete.Skip(i).Take(deleteChunkSize).ToList();
                        // Offer lines and POS group buttons point at articles by Seq with no
                        // foreign key, so leaving them behind makes deleted materials keep
                        // showing up inside offers and on the cashier's group buttons.
                        await conn.ExecuteAsync(new CommandDefinition(
                            "DELETE FROM offer_details WHERE item_id IN @seqs AND COALESCE(excluded, 0) = 0",
                            new { seqs = chunk }, cancellationToken: ct));
                        await conn.ExecuteAsync(new CommandDefinition(
                            "DELETE FROM article_group_items WHERE barcode_id IN @seqs",
                            new { seqs = chunk }, cancellationToken: ct));
                        deleted += await conn.ExecuteAsync(new CommandDefinition(
                            "DELETE FROM articles WHERE Seq IN @seqs",
                            new { seqs = chunk }, cancellationToken: ct));
                    }
                }
                catch (Exception ex)
                {
                    // Best-effort cleanup — a failure here must not undo the successful add/update pass.
                    await syncRepo.LogOperationAsync("articles_sync", "warning",
                        $"فشل تنظيف العناصر المحذوفة من الإداري: {ex.Message}", ct);
                }

                // Also drop offer lines whose Seq never existed locally (e.g. copied from
                // the old app) or whose name is empty — those never appear in toDelete.
                try
                {
                    await conn.ExecuteAsync(new CommandDefinition("""
                        DELETE od
                        FROM offer_details od
                        WHERE COALESCE(od.excluded, 0) = 0
                          AND (
                                od.item_id IS NULL
                             OR NOT EXISTS (
                                SELECT 1 FROM articles a
                                WHERE a.Seq = od.item_id
                                  AND NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), a.Name1))), N'') IS NOT NULL
                             )
                          )
                        """, cancellationToken: ct));
                }
                catch (Exception ex)
                {
                    await syncRepo.LogOperationAsync("articles_sync", "warning",
                        $"فشل تنظيف بنود العروض اليتيمة: {ex.Message}", ct);
                }
            }

        }

        catch (Exception ex)

        {

            var msg = $"{ex.GetType().Name}: {ex.Message}";

            await syncRepo.LogOperationAsync("articles_sync", "failed", msg, ct);

            return new EdariArticlesSyncResult(false, msg, added, updated, total, DateTime.UtcNow, deleted);

        }



        dashboardCache.Invalidate();

        var message = total == 0

            ? "لا مواد في Edari"

            : $"تمت مزامنة {total:N0} مادة — {added:N0} جديد، {updated:N0} محدّث" + (deleted > 0 ? $"، {deleted:N0} محذوف" : "");

        await syncRepo.LogOperationAsync("articles_sync", "success", message, ct);

        return new EdariArticlesSyncResult(true, message, added, updated, total, DateTime.UtcNow, deleted);

    }



    private static async Task BulkInsertArticlesAsync(SqlConnection conn, IReadOnlyList<EdariMaterialRow> rows, CancellationToken ct)

    {

        var table = BuildArticleTable(rows);

        using var bulk = new SqlBulkCopy(conn, SqlBulkCopyOptions.CheckConstraints, null)

        {

            DestinationTableName = "articles",

            BatchSize = InsertChunkSize,

        };

        foreach (DataColumn col in table.Columns)

            bulk.ColumnMappings.Add(col.ColumnName, col.ColumnName);

        await bulk.WriteToServerAsync(table, ct);

    }



    private static async Task InsertArticlesChunkedAsync(System.Data.Common.DbConnection conn, IReadOnlyList<EdariMaterialRow> rows, CancellationToken ct)

    {

        for (var i = 0; i < rows.Count; i += InsertChunkSize)

        {

            var chunk = rows.Skip(i).Take(InsertChunkSize).ToList();

            await conn.ExecuteAsync(new CommandDefinition("""

                INSERT INTO articles (Seq, Num, Name1, Barcode, Father, Sub, SellPr4, SellPr5, CurTot1)

                VALUES (@Seq, @Num, @Name1, @Barcode, @Father, @Sub, @SellPr4, @SellPr5, @CurTot1)

                """, chunk, cancellationToken: ct));

        }

    }



    private static DataTable BuildArticleTable(IReadOnlyList<EdariMaterialRow> rows)

    {

        var table = new DataTable();

        table.Columns.Add("Seq", typeof(long));

        table.Columns.Add("Num", typeof(string));

        table.Columns.Add("Name1", typeof(string));

        table.Columns.Add("Barcode", typeof(string));

        table.Columns.Add("Father", typeof(long));

        table.Columns.Add("Sub", typeof(long));

        table.Columns.Add("SellPr4", typeof(decimal));

        table.Columns.Add("SellPr5", typeof(decimal));

        table.Columns.Add("CurTot1", typeof(decimal));

        foreach (var row in rows)

        {

            table.Rows.Add(

                row.Seq,

                row.Num ?? (object)DBNull.Value,

                row.Name1 ?? (object)DBNull.Value,

                row.Barcode ?? (object)DBNull.Value,

                row.Father,

                row.Sub,

                row.SellPr4,

                row.SellPr5,

                row.CurTot1);

        }

        return table;

    }



    private static EdariMaterialRow CloneRow(EdariMaterialRow source) => new()

    {

        Seq = source.Seq,

        Num = source.Num,

        Name1 = source.Name1,

        Barcode = source.Barcode,

        Father = source.Father,

        Sub = source.Sub,

        SellPr4 = source.SellPr4,

        SellPr5 = 0,

        CurTot1 = source.CurTot1,

    };

}



public sealed record EdariArticlesSyncResult(

    bool Success,

    string Message,

    int Added,

    int Updated,

    int Total,

    DateTime FinishedAt,

    int Deleted = 0);


