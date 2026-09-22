-- استبعاد دائم لمنتج من شجرة كاملة: يبقى بعد جلب الإداري وإعادة توسيع الشجرة
IF OBJECT_ID(N'dbo.ext_commission_group_exclusions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_commission_group_exclusions (
        group_id BIGINT NOT NULL,
        article_id BIGINT NOT NULL,
        source_tree_seq BIGINT NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_cge_created DEFAULT GETDATE(),
        CONSTRAINT PK_ext_commission_group_exclusions PRIMARY KEY (group_id, article_id)
    );
END
GO

IF OBJECT_ID(N'dbo.offer_tree_exclusions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.offer_tree_exclusions (
        offer_id BIGINT NOT NULL,
        item_id BIGINT NOT NULL,
        source_tree_seq BIGINT NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_ote_created DEFAULT GETDATE(),
        CONSTRAINT PK_offer_tree_exclusions PRIMARY KEY (offer_id, item_id)
    );
END
GO

IF OBJECT_ID(N'dbo.ext_target_rule_exclusions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_target_rule_exclusions (
        rule_id BIGINT NOT NULL,
        article_id BIGINT NOT NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_tre_created DEFAULT GETDATE(),
        CONSTRAINT PK_ext_target_rule_exclusions PRIMARY KEY (rule_id, article_id)
    );
END
GO

IF COL_LENGTH('ext_commission_group_items', 'excluded') IS NOT NULL
    INSERT INTO dbo.ext_commission_group_exclusions (group_id, article_id, source_tree_seq)
    SELECT i.group_id, i.article_id, i.source_tree_seq
    FROM dbo.ext_commission_group_items i
    WHERE COALESCE(i.excluded, 0) = 1
      AND i.article_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM dbo.ext_commission_group_exclusions x
          WHERE x.group_id = i.group_id AND x.article_id = i.article_id
      );
GO

IF COL_LENGTH('offer_details', 'excluded') IS NOT NULL
    INSERT INTO dbo.offer_tree_exclusions (offer_id, item_id, source_tree_seq)
    SELECT od.offer_id, od.item_id, od.source_tree_seq
    FROM dbo.offer_details od
    WHERE COALESCE(od.excluded, 0) = 1
      AND od.item_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM dbo.offer_tree_exclusions x
          WHERE x.offer_id = od.offer_id AND x.item_id = od.item_id
      );
GO
