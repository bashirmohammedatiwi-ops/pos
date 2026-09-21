-- Link cashiers directly to cash box accounts (Edari File11n Seq)
IF COL_LENGTH('cashiers', 'master_account') IS NULL
    ALTER TABLE cashiers ADD master_account BIGINT NULL;

IF COL_LENGTH('cashiers', 'master_account_bank') IS NULL
    ALTER TABLE cashiers ADD master_account_bank INT NULL;
