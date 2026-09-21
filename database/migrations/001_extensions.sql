-- Extension tables for FOT POS V2 (run on FOT_POS_V2 only)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_users')
CREATE TABLE ext_users (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    username        NVARCHAR(100) NOT NULL UNIQUE,
    password_hash   NVARCHAR(256) NOT NULL,
    display_name    NVARCHAR(200) NOT NULL,
    role            NVARCHAR(50) NOT NULL CHECK (role IN ('admin', 'manager', 'accountant', 'supervisor')),
    is_active       BIT NOT NULL DEFAULT 1,
    created_at      DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_rules')
CREATE TABLE ext_commission_rules (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    product_id          BIGINT NULL,
    article_barcode     NVARCHAR(50) NULL,
    commission_type     NVARCHAR(20) NOT NULL CHECK (commission_type IN ('fixed', 'percentage')),
    commission_value    DECIMAL(18,4) NOT NULL,
    effective_from      DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    effective_to        DATE NULL,
    is_active           BIT NOT NULL DEFAULT 1,
    created_by          NVARCHAR(100) NULL,
    created_at          DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_target_rules')
CREATE TABLE ext_target_rules (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    name            NVARCHAR(200) NOT NULL,
    product_id      BIGINT NULL,
    target_type     NVARCHAR(20) NOT NULL CHECK (target_type IN ('quantity', 'amount')),
    target_value    DECIMAL(18,4) NOT NULL,
    period_type     NVARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    start_date      DATE NOT NULL,
    end_date        DATE NULL,
    is_active       BIT NOT NULL DEFAULT 1,
    created_at      DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

PRINT 'FOT_POS_V2 extensions ready.';
GO
