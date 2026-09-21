-- Multiple cash boxes per cashier
IF OBJECT_ID('cashier_cashboxes', 'U') IS NULL
BEGIN
    CREATE TABLE cashier_cashboxes (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        cashier_id BIGINT NOT NULL,
        master_account BIGINT NOT NULL,
        master_account_bank INT NOT NULL CONSTRAINT DF_cashier_cashboxes_bank DEFAULT (0),
        is_default BIT NOT NULL CONSTRAINT DF_cashier_cashboxes_default DEFAULT (0),
        sort_order INT NOT NULL CONSTRAINT DF_cashier_cashboxes_sort DEFAULT (0),
        CONSTRAINT FK_cashier_cashboxes_cashier FOREIGN KEY (cashier_id) REFERENCES cashiers(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX UX_cashier_cashbox_account ON cashier_cashboxes(cashier_id, master_account);
    CREATE INDEX IX_cashier_cashboxes_cashier ON cashier_cashboxes(cashier_id);
END;

-- Migrate existing single cash box assignments
INSERT INTO cashier_cashboxes (cashier_id, master_account, master_account_bank, is_default, sort_order)
SELECT c.id, c.master_account, COALESCE(c.master_account_bank, 0), 1, 0
FROM cashiers c
WHERE c.master_account IS NOT NULL AND c.master_account <> 0
  AND NOT EXISTS (
      SELECT 1 FROM cashier_cashboxes cc
      WHERE cc.cashier_id = c.id AND cc.master_account = c.master_account);

-- Store active cash box on each receipt for reporting / Edari
IF COL_LENGTH('reciepts', 'master_account') IS NULL
    ALTER TABLE reciepts ADD master_account BIGINT NULL;
