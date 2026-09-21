-- Commission groups: bundle products/trees under one commission amount
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_groups')
CREATE TABLE ext_commission_groups (
    id               BIGINT IDENTITY(1,1) PRIMARY KEY,
    name             NVARCHAR(200) NOT NULL,
    description      NVARCHAR(500) NULL,
    commission_type  NVARCHAR(20) NOT NULL CONSTRAINT DF_cg_type DEFAULT N'fixed',
    commission_value DECIMAL(18,4) NOT NULL,
    salesman_id      BIGINT NULL,
    label            NVARCHAR(200) NULL,
    sort_order       INT NOT NULL CONSTRAINT DF_cg_sort DEFAULT 0,
    color_hex        NVARCHAR(20) NULL,
    is_active        BIT NOT NULL CONSTRAINT DF_cg_active DEFAULT 1,
    effective_from   DATE NOT NULL CONSTRAINT DF_cg_from DEFAULT CAST(GETDATE() AS DATE),
    effective_to     DATE NULL,
    created_at       DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at       DATETIME2 NULL
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_group_trees')
CREATE TABLE ext_commission_group_trees (
    id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    group_id      BIGINT NOT NULL,
    tree_seq      BIGINT NOT NULL,
    tree_name     NVARCHAR(300) NULL,
    is_full_tree  BIT NOT NULL CONSTRAINT DF_cgt_full DEFAULT 1,
    created_at    DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_cgt_group FOREIGN KEY (group_id) REFERENCES ext_commission_groups(id) ON DELETE CASCADE,
    CONSTRAINT UQ_cgt_group_tree UNIQUE (group_id, tree_seq)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_group_items')
CREATE TABLE ext_commission_group_items (
    id               BIGINT IDENTITY(1,1) PRIMARY KEY,
    group_id         BIGINT NOT NULL,
    article_id       BIGINT NULL,
    barcode          NVARCHAR(100) NULL,
    article_name     NVARCHAR(400) NULL,
    source_tree_seq  BIGINT NULL,
    source_tree_name NVARCHAR(300) NULL,
    created_at       DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_cgi_group FOREIGN KEY (group_id) REFERENCES ext_commission_groups(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cgi_article' AND object_id = OBJECT_ID('ext_commission_group_items'))
BEGIN
    SET QUOTED_IDENTIFIER ON;
    CREATE INDEX IX_cgi_article ON ext_commission_group_items(article_id) WHERE article_id IS NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cgi_barcode' AND object_id = OBJECT_ID('ext_commission_group_items'))
BEGIN
    SET QUOTED_IDENTIFIER ON;
    CREATE INDEX IX_cgi_barcode ON ext_commission_group_items(barcode) WHERE barcode IS NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_cgi_source_tree' AND object_id = OBJECT_ID('ext_commission_group_items'))
BEGIN
    SET QUOTED_IDENTIFIER ON;
    CREATE INDEX IX_cgi_source_tree ON ext_commission_group_items(source_tree_seq) WHERE source_tree_seq IS NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'commission_group_id')
    ALTER TABLE ext_commission_calculations ADD commission_group_id BIGINT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ext_commission_calculations') AND name = 'commission_group_name')
    ALTER TABLE ext_commission_calculations ADD commission_group_name NVARCHAR(200) NULL;
GO

PRINT 'FOT_POS_V2 commission groups ready.';
GO
