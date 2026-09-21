-- Business week settings for commissions and targets (default: Saturday–Friday).
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_business_period_settings')
CREATE TABLE ext_business_period_settings (
    id                  INT NOT NULL PRIMARY KEY DEFAULT 1,
    week_start_day      INT NOT NULL DEFAULT 6,
    week_length_days    INT NOT NULL DEFAULT 7,
    updated_at          DATETIME2 NOT NULL DEFAULT GETDATE(),
    CONSTRAINT CK_ext_business_period_settings_singleton CHECK (id = 1),
    CONSTRAINT CK_ext_business_period_week_start CHECK (week_start_day BETWEEN 0 AND 6),
    CONSTRAINT CK_ext_business_period_week_length CHECK (week_length_days BETWEEN 1 AND 14)
);
GO

IF NOT EXISTS (SELECT 1 FROM ext_business_period_settings WHERE id = 1)
    INSERT INTO ext_business_period_settings (id, week_start_day, week_length_days) VALUES (1, 6, 7);
GO

PRINT 'ext_business_period_settings ready.';
GO
