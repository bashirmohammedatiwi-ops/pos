-- ارتباط حي: بصمة الإداري وآخر فحص / تغيير
USE [FOT_POS_V2];
GO

IF COL_LENGTH('ext_edari_settings', 'last_edari_fingerprint') IS NULL
    ALTER TABLE ext_edari_settings ADD last_edari_fingerprint NVARCHAR(240) NULL;
GO

IF COL_LENGTH('ext_edari_settings', 'last_heartbeat_at') IS NULL
    ALTER TABLE ext_edari_settings ADD last_heartbeat_at DATETIME2 NULL;
GO

IF COL_LENGTH('ext_edari_settings', 'last_change_detected_at') IS NULL
    ALTER TABLE ext_edari_settings ADD last_change_detected_at DATETIME2 NULL;
GO
