-- Card-paid receipts post to Edari against this account (e.g. the QiCard bank/settlement
-- account), the same way edari_gift_account routes gift invoices. Without it, card money was
-- posted exactly like anonymous cash (Acc=0), landing in the branch cash box instead of the
-- card settlement account on merge. Unset must be 0 so the sync fails loudly instead of
-- posting to whatever account happens to carry a stale default Seq.

IF COL_LENGTH('ext_pos_cashbox_settings', 'edari_qi_account') IS NULL
    ALTER TABLE ext_pos_cashbox_settings ADD edari_qi_account INT NOT NULL CONSTRAINT DF_pcs_edari_qi_account DEFAULT 0;
GO
