-- Commission calculations + target progress (FOT_POS_V2 only)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_calculations')
CREATE TABLE ext_commission_calculations (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    receipt_id          BIGINT NOT NULL,
    receipt_item_id     BIGINT NULL,
    article_id          BIGINT NOT NULL,
    salesman_id         BIGINT NOT NULL,
    commission_type     NVARCHAR(20) NOT NULL,
    commission_value    DECIMAL(18,4) NOT NULL,
    quantity            DECIMAL(18,4) NOT NULL,
    line_amount         DECIMAL(18,4) NOT NULL,
    commission_amount   DECIMAL(18,4) NOT NULL,
    calculated_at       DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_target_progress')
CREATE TABLE ext_target_progress (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    rule_id         BIGINT NOT NULL,
    period_start    DATE NOT NULL,
    current_value   DECIMAL(18,4) NOT NULL DEFAULT 0,
    updated_at      DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_ext_target_progress_rule_period UNIQUE (rule_id, period_start)
);
GO

PRINT 'FOT_POS_V2 commission/target tables ready.';
GO
