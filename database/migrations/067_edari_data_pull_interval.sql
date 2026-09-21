-- مدة جلب بيانات الإداري (بائعون / منتجات / فروع) مستقلة عن ترحيل الفواتير.

USE [FOT_POS_V2];
GO

IF COL_LENGTH('ext_edari_settings', 'data_pull_interval_seconds') IS NULL
    ALTER TABLE ext_edari_settings ADD data_pull_interval_seconds INT NULL;
GO

UPDATE ext_edari_settings
SET data_pull_interval_seconds = 240
WHERE id = 1 AND data_pull_interval_seconds IS NULL;
GO
