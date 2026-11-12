-- «كاشير الطلبات»: إخفاء اسم الزبونة من ملصق شركة التوصيل عند الطباعة (يبقى في التطبيق وعند شركة التوصيل).
-- إضافي فقط ويُعاد تشغيله بأمان.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.ext_online_orders_settings', 'label_hide_customer') IS NULL
    ALTER TABLE dbo.ext_online_orders_settings ADD label_hide_customer BIT NOT NULL CONSTRAINT DF_ext_oos_label_hide_customer DEFAULT (0);
GO
