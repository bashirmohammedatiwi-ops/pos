-- إعادة ضبط حالة ترحيل Edari: مسح السجل وإغلاق قائمة الانتظار
USE [FOT_POS_V2];
GO

-- مسح سجل محاولات الترحيل (فشل / نجاح)
DELETE FROM ext_edari_sync_log;
GO

-- اعتبار جميع الفواتير غير المعلّقة كـ «مرحّلة» (لا تحذف سجلات المبيعات)
UPDATE reciepts
SET synced = 1
WHERE synced = 0 AND is_pending = 0;
GO

PRINT 'Edari sync queue cleared.';
GO
