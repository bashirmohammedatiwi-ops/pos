-- Each cashier gets a dedicated permissions row (clone when shared)
DECLARE @cashierId BIGINT;
DECLARE @permId BIGINT;
DECLARE @username NVARCHAR(200);
DECLARE @newPermId BIGINT;

DECLARE cashier_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT id, cashiers_permissions_id, username FROM cashiers;

OPEN cashier_cursor;
FETCH NEXT FROM cashier_cursor INTO @cashierId, @permId, @username;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF (SELECT COUNT(*) FROM cashiers WHERE cashiers_permissions_id = @permId) > 1
    BEGIN
        INSERT INTO cashiers_permissions (
            name, make_discount, view_reciepts, cash_report, delete_item, duplicate_item,
            offline_login, discard_receipt, allow_credit_recipt, allow_sales_return_reciept,
            allow_gift_reciept, allow_price_change, allow_search_articles, allow_edit_reciept,
            item_discount_limit, user_discount_limit, number_of_hold_reciepts)
        SELECT
            @username + N' — صلاحيات',
            make_discount, view_reciepts, cash_report, delete_item, duplicate_item,
            offline_login, discard_receipt, allow_credit_recipt, allow_sales_return_reciept,
            allow_gift_reciept, allow_price_change, allow_search_articles, allow_edit_reciept,
            item_discount_limit, user_discount_limit, number_of_hold_reciepts
        FROM cashiers_permissions WHERE id = @permId;

        SET @newPermId = SCOPE_IDENTITY();
        UPDATE cashiers SET cashiers_permissions_id = @newPermId WHERE id = @cashierId;
    END
    ELSE
    BEGIN
        UPDATE cashiers_permissions
        SET name = @username + N' — صلاحيات'
        WHERE id = @permId;
    END

    FETCH NEXT FROM cashier_cursor INTO @cashierId, @permId, @username;
END

CLOSE cashier_cursor;
DEALLOCATE cashier_cursor;
