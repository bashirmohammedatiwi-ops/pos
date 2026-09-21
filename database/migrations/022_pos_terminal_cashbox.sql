-- Link POS terminals directly to cash box accounts (Edari File11n Seq)
IF COL_LENGTH('point_of_sales', 'master_account') IS NULL
    ALTER TABLE point_of_sales ADD master_account BIGINT NULL;

IF COL_LENGTH('point_of_sales', 'master_account_bank') IS NULL
    ALTER TABLE point_of_sales ADD master_account_bank INT NULL;

-- Backfill from section defaults where terminal has no direct account
UPDATE p
SET
    p.master_account = s.master_account,
    p.master_account_bank = s.master_account_bank
FROM point_of_sales p
INNER JOIN sections s ON s.id = p.section_id
WHERE (p.master_account IS NULL OR p.master_account = 0)
  AND s.master_account IS NOT NULL
  AND s.master_account <> 0;
