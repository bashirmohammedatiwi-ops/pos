-- سياسة إعادة محاولة الترحيل + الحروف الميتة (dead-letter)
-- فاتورة تفشل لسبب بنيوي (صنف مفقود، قسم غير مربوط) تتوقف بعد محاولات محدودة
-- بدل إعادة المحاولة كل دورة إلى الأبد.
USE [FOT_POS_V2];
GO

IF COL_LENGTH('reciepts', 'sync_attempts') IS NULL
    ALTER TABLE reciepts ADD sync_attempts INT NOT NULL CONSTRAINT DF_reciepts_sync_attempts DEFAULT 0;
GO

IF COL_LENGTH('reciepts', 'last_sync_attempt_at') IS NULL
    ALTER TABLE reciepts ADD last_sync_attempt_at DATETIME2 NULL;
GO

IF COL_LENGTH('reciepts', 'next_sync_at') IS NULL
    ALTER TABLE reciepts ADD next_sync_at DATETIME2 NULL;
GO

IF COL_LENGTH('reciepts', 'dead_letter') IS NULL
    ALTER TABLE reciepts ADD dead_letter BIT NOT NULL CONSTRAINT DF_reciepts_dead_letter DEFAULT 0;
GO

IF COL_LENGTH('reciepts', 'dead_reason') IS NULL
    ALTER TABLE reciepts ADD dead_reason NVARCHAR(400) NULL;
GO

-- فهرس مُرشَّح لمسح طابور الترحيل: الصفوف المؤهلة فقط
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_reciepts_sync_queue' AND object_id = OBJECT_ID('reciepts')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_reciepts_sync_queue
        ON reciepts (id)
        WHERE synced = 0 AND is_pending = 0 AND dead_letter = 0;
END
GO

-- فاصل فحص بصمة الإداري (بالثواني) — NULL يعني الافتراضي 30
IF COL_LENGTH('ext_edari_settings', 'detect_seconds') IS NULL
    ALTER TABLE ext_edari_settings ADD detect_seconds INT NULL;
GO

-- رفع حالة طابور نقطة البيع (فواتير offline بانتظار الرفع / متوقفة) إلى مراقبة الإدارة
IF COL_LENGTH('point_of_sales', 'pending_offline') IS NULL
    ALTER TABLE point_of_sales ADD pending_offline INT NOT NULL CONSTRAINT DF_pos_pending_offline DEFAULT 0;
GO

IF COL_LENGTH('point_of_sales', 'dead_offline') IS NULL
    ALTER TABLE point_of_sales ADD dead_offline INT NOT NULL CONSTRAINT DF_pos_dead_offline DEFAULT 0;
GO
