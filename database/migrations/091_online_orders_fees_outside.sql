-- «كاشير الطلبات»: أجور التوصيل وتغليف الهدية لطلبات التوصيل لا تدخل فاتورة المحل (ولا الإداري) —
-- تبقى ضمن مبلغ شركة التوصيل فقط، وتُحفظ مع ربط الطلب لتظهر ملاحظةً على الفاتورة في لوحة التحكم.
-- إضافي فقط ويُعاد تشغيله بأمان.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.ext_online_order_receipts', 'delivery_fee') IS NULL
    ALTER TABLE dbo.ext_online_order_receipts ADD delivery_fee DECIMAL(18,2) NOT NULL CONSTRAINT DF_ext_oor_delivery_fee DEFAULT (0);
GO
IF COL_LENGTH('dbo.ext_online_order_receipts', 'gift_wrap_fee') IS NULL
    ALTER TABLE dbo.ext_online_order_receipts ADD gift_wrap_fee DECIMAL(18,2) NOT NULL CONSTRAINT DF_ext_oor_gift_wrap_fee DEFAULT (0);
GO
