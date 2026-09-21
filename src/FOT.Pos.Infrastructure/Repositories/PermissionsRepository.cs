using Dapper;
using FOT.Pos.Shared.Dtos;
using FOT.Pos.Infrastructure.Data;

namespace FOT.Pos.Infrastructure.Repositories;

public sealed class PermissionsRepository(ISqlConnectionFactory db)
{
    public async Task<CashierPermissionsDto?> GetByIdAsync(long id, CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, name AS Name,
                   CAST(make_discount AS bit) AS MakeDiscount,
                   CAST(view_reciepts AS bit) AS ViewReceipts,
                   CAST(cash_report AS bit) AS CashReport,
                   CAST(delete_item AS bit) AS DeleteItem,
                   CAST(duplicate_item AS bit) AS DuplicateItem,
                   CAST(offline_login AS bit) AS OfflineLogin,
                   CAST(discard_receipt AS bit) AS DiscardReceipt,
                   CAST(allow_credit_recipt AS bit) AS AllowCreditReceipt,
                   CAST(allow_sales_return_reciept AS bit) AS AllowSalesReturn,
                   CAST(allow_gift_reciept AS bit) AS AllowGiftReceipt,
                   CAST(allow_price_change AS bit) AS AllowPriceChange,
                   CAST(allow_search_articles AS bit) AS AllowSearchArticles,
                   CAST(allow_edit_reciept AS bit) AS AllowEditReceipt,
                   CAST(manual_transfer AS bit) AS ManualTransfer,
                   CAST(allow_product_discount AS bit) AS AllowProductDiscount,
                   CAST(hide_salesman_groups AS bit) AS HideSalesmanGroups,
                   CAST(invoice_bound_return AS bit) AS InvoiceBoundReturn,
                   CAST(item_discount_limit AS DECIMAL(18,2)) AS ItemDiscountLimit,
                   CAST(user_discount_limit AS DECIMAL(18,2)) AS UserDiscountLimit,
                   number_of_hold_reciepts AS NumberOfHoldReceipts
            FROM cashiers_permissions WHERE id = @id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowOrDefaultAsync<CashierPermissionsDto>(
            new CommandDefinition(sql, new { id }, cancellationToken: ct));
    }

    public async Task<long> CreateAsync(string name, UpdatePermissionsRequest req, CancellationToken ct)
    {
        const string sql = """
            INSERT INTO cashiers_permissions (
                name, make_discount, view_reciepts, cash_report, delete_item, duplicate_item,
                offline_login, discard_receipt, allow_credit_recipt, allow_sales_return_reciept,
                allow_gift_reciept, allow_price_change, allow_search_articles, allow_edit_reciept,
                manual_transfer, allow_product_discount, hide_salesman_groups, invoice_bound_return,
                item_discount_limit, user_discount_limit, number_of_hold_reciepts)
            OUTPUT INSERTED.id
            VALUES (
                @name, @MakeDiscount, @ViewReceipts, @CashReport, @DeleteItem, @DuplicateItem,
                @OfflineLogin, @DiscardReceipt, @AllowCreditReceipt, @AllowSalesReturn,
                @AllowGiftReceipt, @AllowPriceChange, @AllowSearchArticles, @AllowEditReceipt,
                @ManualTransfer, @AllowProductDiscount, @HideSalesmanGroups, @InvoiceBoundReturn,
                @ItemDiscountLimit, @UserDiscountLimit, @NumberOfHoldReceipts)
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<long>(new CommandDefinition(sql, PermissionParams(name, req), cancellationToken: ct));
    }

    public async Task UpdateAsync(long id, UpdatePermissionsRequest req, CancellationToken ct)
    {
        const string sql = """
            UPDATE cashiers_permissions SET
                make_discount=@MakeDiscount, view_reciepts=@ViewReceipts, cash_report=@CashReport,
                delete_item=@DeleteItem, duplicate_item=@DuplicateItem, offline_login=@OfflineLogin,
                discard_receipt=@DiscardReceipt, allow_credit_recipt=@AllowCreditReceipt,
                allow_sales_return_reciept=@AllowSalesReturn, allow_gift_reciept=@AllowGiftReceipt,
                allow_price_change=@AllowPriceChange, allow_search_articles=@AllowSearchArticles,
                allow_edit_reciept=@AllowEditReceipt,
                manual_transfer=@ManualTransfer, allow_product_discount=@AllowProductDiscount,
                hide_salesman_groups=@HideSalesmanGroups,
                invoice_bound_return=@InvoiceBoundReturn,
                item_discount_limit=@ItemDiscountLimit, user_discount_limit=@UserDiscountLimit,
                number_of_hold_reciepts=@NumberOfHoldReceipts
            WHERE id=@id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(sql, new { id, req.MakeDiscount, req.ViewReceipts,
            req.CashReport, req.DeleteItem, req.DuplicateItem, req.OfflineLogin, req.DiscardReceipt,
            req.AllowCreditReceipt, req.AllowSalesReturn, req.AllowGiftReceipt, req.AllowPriceChange,
            req.AllowSearchArticles, req.AllowEditReceipt, req.ManualTransfer, req.AllowProductDiscount,
            req.HideSalesmanGroups, req.InvoiceBoundReturn,
            req.ItemDiscountLimit, req.UserDiscountLimit, req.NumberOfHoldReceipts }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<CashierPermissionsDto>> ListAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT id AS Id, name AS Name,
                   CAST(make_discount AS bit) AS MakeDiscount,
                   CAST(view_reciepts AS bit) AS ViewReceipts,
                   CAST(cash_report AS bit) AS CashReport,
                   CAST(delete_item AS bit) AS DeleteItem,
                   CAST(duplicate_item AS bit) AS DuplicateItem,
                   CAST(offline_login AS bit) AS OfflineLogin,
                   CAST(discard_receipt AS bit) AS DiscardReceipt,
                   CAST(allow_credit_recipt AS bit) AS AllowCreditReceipt,
                   CAST(allow_sales_return_reciept AS bit) AS AllowSalesReturn,
                   CAST(allow_gift_reciept AS bit) AS AllowGiftReceipt,
                   CAST(allow_price_change AS bit) AS AllowPriceChange,
                   CAST(allow_search_articles AS bit) AS AllowSearchArticles,
                   CAST(allow_edit_reciept AS bit) AS AllowEditReceipt,
                   CAST(manual_transfer AS bit) AS ManualTransfer,
                   CAST(allow_product_discount AS bit) AS AllowProductDiscount,
                   CAST(hide_salesman_groups AS bit) AS HideSalesmanGroups,
                   CAST(invoice_bound_return AS bit) AS InvoiceBoundReturn,
                   CAST(item_discount_limit AS DECIMAL(18,2)) AS ItemDiscountLimit,
                   CAST(user_discount_limit AS DECIMAL(18,2)) AS UserDiscountLimit,
                   number_of_hold_reciepts AS NumberOfHoldReceipts
            FROM cashiers_permissions ORDER BY id
            """;
        await using var conn = await db.CreateOpenConnectionAsync(ct);
        return await conn.QueryRowsAsync<CashierPermissionsDto>(new CommandDefinition(sql, cancellationToken: ct));
    }

    private static object PermissionParams(string name, UpdatePermissionsRequest req) => new
    {
        name,
        req.MakeDiscount,
        req.ViewReceipts,
        req.CashReport,
        req.DeleteItem,
        req.DuplicateItem,
        req.OfflineLogin,
        req.DiscardReceipt,
        req.AllowCreditReceipt,
        req.AllowSalesReturn,
        req.AllowGiftReceipt,
        req.AllowPriceChange,
        req.AllowSearchArticles,
        req.AllowEditReceipt,
        req.ManualTransfer,
        req.AllowProductDiscount,
        req.HideSalesmanGroups,
        req.InvoiceBoundReturn,
        req.ItemDiscountLimit,
        req.UserDiscountLimit,
        req.NumberOfHoldReceipts
    };
}
