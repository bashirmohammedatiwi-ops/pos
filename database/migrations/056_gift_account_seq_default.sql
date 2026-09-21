-- edari_gift_account stores an Edari account Seq (e.g. 84 for «3133 هدايا»), not an
-- account number. The old 3133 default is a NUMBER, so an unsaved install would post
-- gift invoices to whatever account carries Seq 3133. Unset must be 0, which makes the
-- Edari sync fail loudly ("حساب الهدايا غير مضبوط") instead of posting to a wrong account.

UPDATE ext_pos_cashbox_settings
SET edari_gift_account = 0
WHERE gift_master_account IS NULL AND edari_gift_account = 3133;
GO

DECLARE @df NVARCHAR(200) = (
    SELECT dc.name FROM sys.default_constraints dc
    WHERE dc.parent_object_id = OBJECT_ID('ext_pos_cashbox_settings')
      AND dc.parent_column_id = COLUMNPROPERTY(OBJECT_ID('ext_pos_cashbox_settings'), 'edari_gift_account', 'ColumnId'));
IF @df IS NOT NULL
    EXEC(N'ALTER TABLE ext_pos_cashbox_settings DROP CONSTRAINT ' + @df);
ALTER TABLE ext_pos_cashbox_settings ADD CONSTRAINT DF_pcs_edari_gift_account DEFAULT 0 FOR edari_gift_account;
GO
