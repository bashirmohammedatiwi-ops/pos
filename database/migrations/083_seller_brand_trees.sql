-- ربط حسابات البائعين (موظفي البراندات) بشجرات المواد — كل شجرة = براند مستقل
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_seller_brand_trees')
CREATE TABLE ext_seller_brand_trees (
    salesman_id BIGINT NOT NULL,
    tree_seq    BIGINT NOT NULL,
    tree_name   NVARCHAR(300) NULL,
    sort_order  INT NOT NULL CONSTRAINT DF_ext_seller_brand_trees_sort DEFAULT (0),
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_ext_seller_brand_trees_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_ext_seller_brand_trees PRIMARY KEY (salesman_id, tree_seq)
);
GO
