-- وقت آخر جلب للبيانات من Edari
USE [FOT_POS_V2];
GO

IF NOT EXISTS (
    SELECT * FROM sys.columns
    WHERE object_id = OBJECT_ID('ext_edari_settings') AND name = 'last_data_pull_at'
)
ALTER TABLE ext_edari_settings ADD last_data_pull_at DATETIME2 NULL;
GO
