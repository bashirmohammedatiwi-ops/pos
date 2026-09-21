-- Edari integration settings + tree-linked targets (FOT_POS_V2 only)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_edari_settings')
CREATE TABLE ext_edari_settings (
    id                          INT NOT NULL PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    data_root                   NVARCHAR(500) NOT NULL DEFAULT N'D:\Future of Technology\EdariNX\Data',
    database_alias              NVARCHAR(50) NOT NULL DEFAULT N'2025',
    server                      NVARCHAR(200) NOT NULL DEFAULT N'127.0.0.1',
    port                        INT NOT NULL DEFAULT 16000,
    odbc_driver                 NVARCHAR(200) NOT NULL DEFAULT N'Devart ODBC Driver for NexusDB',
    enabled                     BIT NOT NULL DEFAULT 1,
    auto_sync_enabled           BIT NOT NULL DEFAULT 1,
    auto_sync_interval_seconds  INT NOT NULL DEFAULT 120,
    catalog_sync_enabled        BIT NOT NULL DEFAULT 1,
    last_receipt_sync_at        DATETIME2 NULL,
    last_catalog_sync_at        DATETIME2 NULL,
    last_connection_test_at     DATETIME2 NULL,
    last_connection_ok          BIT NULL,
    last_connection_message     NVARCHAR(500) NULL,
    updated_at                  DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT 1 FROM ext_edari_settings)
INSERT INTO ext_edari_settings (id) VALUES (1);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_edari_offer_map')
CREATE TABLE ext_edari_offer_map (
    offer_id        BIGINT NOT NULL PRIMARY KEY,
    edari_seq       BIGINT NOT NULL,
    edari_name      NVARCHAR(200) NULL,
    last_synced_at  DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('ext_target_rules') AND name = 'edari_tree_seq'
)
ALTER TABLE ext_target_rules ADD
    edari_tree_seq  BIGINT NULL,
    edari_tree_name NVARCHAR(300) NULL;
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('ext_edari_sync_log') AND name = 'operation'
)
ALTER TABLE ext_edari_sync_log ADD
    operation       NVARCHAR(50) NULL DEFAULT N'receipt',
    details         NVARCHAR(2000) NULL;
GO

PRINT 'FOT_POS_V2 Edari integration tables ready.';
GO
