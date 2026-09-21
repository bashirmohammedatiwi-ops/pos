-- Multi-tree sales targets + rule tree links (FOT_POS_V2 only)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_target_rule_trees')
CREATE TABLE ext_target_rule_trees (
    rule_id     BIGINT NOT NULL,
    tree_seq    BIGINT NOT NULL,
    tree_name   NVARCHAR(300) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_ext_target_rule_trees PRIMARY KEY (rule_id, tree_seq),
    CONSTRAINT FK_ext_target_rule_trees_rule FOREIGN KEY (rule_id)
        REFERENCES ext_target_rules(id) ON DELETE CASCADE
);
GO

-- Migrate legacy single-tree columns into link table
INSERT INTO ext_target_rule_trees (rule_id, tree_seq, tree_name)
SELECT r.id, r.edari_tree_seq, r.edari_tree_name
FROM ext_target_rules r
WHERE r.edari_tree_seq IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM ext_target_rule_trees t
      WHERE t.rule_id = r.id AND t.tree_seq = r.edari_tree_seq
  );
GO

PRINT 'FOT_POS_V2 target trees ready.';
GO
