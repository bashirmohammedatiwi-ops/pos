using Dapper;
using FOT.Pos.Infrastructure.Data;
using FOT.Pos.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class PosCashBoxSettingsRepository(ISqlConnectionFactory db, ILogger<PosCashBoxSettingsRepository> logger)
{
    // Labels (Num/Name) are NOT resolved here: these columns store Edari account Seqs
    // while the local accounts mirror is empty, so the endpoints enrich them from Edari.
    private const string SelectSql = """
        SELECT
            s.qi_master_account AS QiMasterAccount,
            COALESCE(s.qi_master_account_bank, 0) AS QiMasterAccountBank,
            s.gift_master_account AS GiftMasterAccount,
            COALESCE(s.gift_master_account_bank, 0) AS GiftMasterAccountBank,
            COALESCE(s.edari_gift_account, 0) AS EdariGiftAccount,
            COALESCE(s.edari_qi_account, 0) AS EdariQiAccount
        FROM ext_pos_cashbox_settings s
        WHERE s.id = 1
        """;

    public async Task<PosCashBoxSettingsDto> GetAsync(CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        try
        {
            var row = await conn.QueryRowOrDefaultAsync<PosCashBoxSettingsDto>(
                new CommandDefinition(SelectSql, cancellationToken: ct));
            return row ?? PosCashBoxSettingsDto.Empty;
        }
        catch (Exception ex)
        {
            // Card/gift routing depends on this row — a silent empty result makes card
            // receipts get rejected, so the failure must at least be visible in logs.
            logger.LogError(ex, "قراءة إعدادات الصناديق فشلت — سيُستخدم وضع فارغ");
            return PosCashBoxSettingsDto.Empty;
        }
    }

    public async Task<PosCashBoxSettingsDto> SaveAsync(UpdatePosCashBoxSettingsRequest req, CancellationToken ct)
    {
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        var rows = await conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ext_pos_cashbox_settings SET
                qi_master_account = @QiMasterAccount,
                qi_master_account_bank = @QiMasterAccountBank,
                gift_master_account = @GiftMasterAccount,
                gift_master_account_bank = @GiftMasterAccountBank,
                edari_gift_account = @EdariGiftAccount,
                edari_qi_account = @EdariQiAccount,
                updated_at = GETDATE()
            WHERE id = 1
            """, Args(req), cancellationToken: ct));

        if (rows == 0)
        {
            // The singleton row can be missing on legacy databases — insert instead of
            // silently no-op'ing the admin's save.
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO ext_pos_cashbox_settings (
                    id, qi_master_account, qi_master_account_bank,
                    gift_master_account, gift_master_account_bank, edari_gift_account, edari_qi_account, updated_at)
                VALUES (
                    1, @QiMasterAccount, @QiMasterAccountBank,
                    @GiftMasterAccount, @GiftMasterAccountBank, @EdariGiftAccount, @EdariQiAccount, GETDATE())
                """, Args(req), cancellationToken: ct));
        }

        return await GetAsync(ct);
    }

    private static object Args(UpdatePosCashBoxSettingsRequest req)
    {
        // Gifts and cards are each one logical account stored in two columns: the POS box and
        // the Edari account the bill posts to are the same Edari Seq. A leftover default
        // (3133 is an account NUMBER, not a Seq) must never survive a save — 0 makes unsent
        // invoices fail loudly instead of posting to whatever account carries that Seq.
        var giftSeq = req.GiftMasterAccount is > 0 ? req.GiftMasterAccount : null;
        var qiSeq = req.QiMasterAccount is > 0 ? req.QiMasterAccount : null;

        // Older clients (and any form loaded before the card pickers were merged) post the
        // Edari card account as 0, which used to silently blank a working setting and stop
        // every card receipt from reaching Edari. The card box now fills it in.
        var edariQi = req.EdariQiAccount > 0
            ? req.EdariQiAccount
            : (int)(qiSeq ?? 0);

        return new
        {
            QiMasterAccount = qiSeq,
            QiMasterAccountBank = qiSeq is > 0 ? (int?)(req.QiMasterAccountBank ?? 0) : null,
            GiftMasterAccount = giftSeq,
            GiftMasterAccountBank = giftSeq is > 0 ? (int?)(req.GiftMasterAccountBank ?? 0) : null,
            EdariGiftAccount = giftSeq is > 0 ? Math.Clamp(req.EdariGiftAccount, 0, int.MaxValue) : 0,
            EdariQiAccount = Math.Clamp(edariQi, 0, int.MaxValue),
        };
    }
}
