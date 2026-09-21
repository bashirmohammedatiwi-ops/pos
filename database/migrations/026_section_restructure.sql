-- Restructure: Section = POS point, section owns cash boxes, cashier belongs to section

IF OBJECT_ID('section_cashboxes', 'U') IS NULL
BEGIN
    CREATE TABLE section_cashboxes (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        section_id BIGINT NOT NULL,
        master_account BIGINT NOT NULL,
        master_account_bank INT NOT NULL CONSTRAINT DF_section_cashboxes_bank DEFAULT (0),
        is_default BIT NOT NULL CONSTRAINT DF_section_cashboxes_default DEFAULT (0),
        sort_order INT NOT NULL CONSTRAINT DF_section_cashboxes_sort DEFAULT (0),
        CONSTRAINT FK_section_cashboxes_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX UX_section_cashbox_account ON section_cashboxes(section_id, master_account);
    CREATE INDEX IX_section_cashboxes_section ON section_cashboxes(section_id);
END;
GO

IF COL_LENGTH('cashiers', 'section_id') IS NULL
    ALTER TABLE cashiers ADD section_id BIGINT NULL;
GO

IF COL_LENGTH('reciepts', 'master_account') IS NULL
    ALTER TABLE reciepts ADD master_account BIGINT NULL;
GO

-- Migrate section single cash box → section_cashboxes
INSERT INTO section_cashboxes (section_id, master_account, master_account_bank, is_default, sort_order)
SELECT s.id, s.master_account, COALESCE(s.master_account_bank, 0), 1, 0
FROM sections s
WHERE s.master_account IS NOT NULL AND s.master_account <> 0
  AND NOT EXISTS (
      SELECT 1 FROM section_cashboxes sc
      WHERE sc.section_id = s.id AND sc.master_account = s.master_account);
GO

-- Migrate cashier cash boxes → section (if cashier had box but section empty, add to section)
IF OBJECT_ID('cashier_cashboxes', 'U') IS NOT NULL
BEGIN
    INSERT INTO section_cashboxes (section_id, master_account, master_account_bank, is_default, sort_order)
    SELECT DISTINCT c.section_id, cc.master_account, cc.master_account_bank, cc.is_default, cc.sort_order
    FROM cashier_cashboxes cc
    INNER JOIN cashiers c ON c.id = cc.cashier_id
    WHERE c.section_id IS NOT NULL AND c.section_id > 0
      AND NOT EXISTS (
          SELECT 1 FROM section_cashboxes sc
          WHERE sc.section_id = c.section_id AND sc.master_account = cc.master_account);
END;
GO

-- Backfill cashier section from first terminal section (heuristic)
UPDATE c SET c.section_id = p.section_id
FROM cashiers c
CROSS APPLY (
    SELECT TOP 1 p.section_id
    FROM reciepts r
    INNER JOIN point_of_sales p ON p.id = r.point_of_sale_id
    WHERE r.cashier_id = c.id AND p.section_id IS NOT NULL
    GROUP BY p.section_id
    ORDER BY COUNT(*) DESC
) p
WHERE (c.section_id IS NULL OR c.section_id = 0) AND p.section_id IS NOT NULL;
GO

-- Default remaining cashiers to first section if exists
UPDATE cashiers SET section_id = (SELECT MIN(id) FROM sections)
WHERE (section_id IS NULL OR section_id = 0)
  AND EXISTS (SELECT 1 FROM sections);
GO
