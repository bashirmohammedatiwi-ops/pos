IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_group_salesmen')
CREATE TABLE ext_commission_group_salesmen (
    group_id    BIGINT NOT NULL,
    salesman_id BIGINT NOT NULL,
    CONSTRAINT PK_cgs PRIMARY KEY (group_id, salesman_id),
    CONSTRAINT FK_cgs_group FOREIGN KEY (group_id) REFERENCES ext_commission_groups(id) ON DELETE CASCADE
);
GO

IF EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_group_salesmen')
AND EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_groups')
INSERT INTO ext_commission_group_salesmen (group_id, salesman_id)
SELECT g.id, g.salesman_id
FROM ext_commission_groups g
WHERE g.salesman_id IS NOT NULL AND g.salesman_id > 0
  AND NOT EXISTS (
      SELECT 1 FROM ext_commission_group_salesmen x
      WHERE x.group_id = g.id AND x.salesman_id = g.salesman_id
  );
GO
