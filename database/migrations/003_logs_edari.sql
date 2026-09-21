-- POS logs + Edari sync tracking (FOT_POS_V2 only)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_pos_logs')
CREATE TABLE ext_pos_logs (
    id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    source      NVARCHAR(50) NOT NULL,
    level       NVARCHAR(20) NOT NULL DEFAULT 'info',
    message     NVARCHAR(2000) NOT NULL,
    details     NVARCHAR(MAX) NULL,
    created_at  DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_edari_sync_log')
CREATE TABLE ext_edari_sync_log (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    receipt_id      BIGINT NOT NULL,
    status          NVARCHAR(20) NOT NULL CHECK (status IN ('pending','success','failed')),
    edr_num         BIGINT NULL,
    error_message   NVARCHAR(2000) NULL,
    attempted_at    DATETIME2 NOT NULL DEFAULT GETDATE()
);
GO

PRINT 'FOT_POS_V2 logs and Edari sync tables ready.';
GO
