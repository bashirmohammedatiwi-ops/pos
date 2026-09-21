-- Gift receipts post to Edari as an output invoice (Kind 3) against this account.
-- 3133 is the established gifts account; the admin can change it from settings.

IF COL_LENGTH('ext_pos_cashbox_settings', 'edari_gift_account') IS NULL
    ALTER TABLE ext_pos_cashbox_settings ADD edari_gift_account INT NOT NULL CONSTRAINT DF_pcs_edari_gift_account DEFAULT 3133;
GO
