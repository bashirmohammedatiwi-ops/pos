-- Edari ADO connection settings (FOT_POS_V2 only)
USE [FOT_POS_V2];
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('ext_edari_settings') AND name = 'connection_mode'
)
ALTER TABLE ext_edari_settings ADD
    connection_mode           NVARCHAR(20) NOT NULL DEFAULT N'Ado',
    ado_provider_path         NVARCHAR(500) NULL,
    ado_connector_directory   NVARCHAR(500) NULL;
GO

UPDATE ext_edari_settings
SET connection_mode = N'Ado'
WHERE id = 1 AND connection_mode = N'Auto';
GO

PRINT 'FOT_POS_V2 Edari ADO connection settings ready.';
GO
