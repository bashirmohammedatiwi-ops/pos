-- Weekly settlement sheet: shared settings + one row per salesman per business week.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_weekly_settlement_settings')
CREATE TABLE ext_weekly_settlement_settings (
    id                  INT NOT NULL PRIMARY KEY DEFAULT 1,
    deduction_percent   DECIMAL(5,2) NOT NULL CONSTRAINT DF_ext_wss_ded DEFAULT 0,
    updated_at          DATETIME2 NOT NULL CONSTRAINT DF_ext_wss_upd DEFAULT GETDATE(),
    CONSTRAINT CK_ext_wss_singleton CHECK (id = 1),
    CONSTRAINT CK_ext_wss_deduction CHECK (deduction_percent >= 0 AND deduction_percent <= 100)
);
GO

IF NOT EXISTS (SELECT 1 FROM ext_weekly_settlement_settings WHERE id = 1)
    INSERT INTO ext_weekly_settlement_settings (id, deduction_percent) VALUES (1, 0);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_weekly_settlement_salesmen')
CREATE TABLE ext_weekly_settlement_salesmen (
    salesman_id     BIGINT NOT NULL,
    sort_order      INT NOT NULL CONSTRAINT DF_ext_wssm_sort DEFAULT 0,
    CONSTRAINT PK_ext_weekly_settlement_salesmen PRIMARY KEY (salesman_id)
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_weekly_settlements')
CREATE TABLE ext_weekly_settlements (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    week_start      DATE NOT NULL,
    salesman_id     BIGINT NOT NULL,
    amount          DECIMAL(18,4) NOT NULL CONSTRAINT DF_ext_ws_amount DEFAULT 0,
    delivered       BIT NOT NULL CONSTRAINT DF_ext_ws_delivered DEFAULT 0,
    delivered_at    DATETIME2 NULL,
    payout_id       BIGINT NULL,
    created_at      DATETIME2 NOT NULL CONSTRAINT DF_ext_ws_created DEFAULT GETDATE(),
    updated_at      DATETIME2 NOT NULL CONSTRAINT DF_ext_ws_updated DEFAULT GETDATE(),
    CONSTRAINT PK_ext_weekly_settlements PRIMARY KEY (id),
    CONSTRAINT UQ_ext_ws_week_salesman UNIQUE (week_start, salesman_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ext_ws_week' AND object_id = OBJECT_ID('ext_weekly_settlements'))
    CREATE INDEX IX_ext_ws_week ON ext_weekly_settlements(week_start, salesman_id)
        INCLUDE (amount, delivered, payout_id);
GO

PRINT 'ext_weekly_settlement tables ready.';
GO
