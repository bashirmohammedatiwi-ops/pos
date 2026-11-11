-- شروط رمز الخصم: حد النسبة والمبلغ، أقل فاتورة، أيام وساعات وتواريخ التفعيل، حدود الاستخدام.
-- كل شرط اختياري: NULL يعني بلا حد، فتبقى الرموز الحالية كما هي.
--   weekdays  قناع بتّات: 1 = الأحد … 64 = السبت (NULL = كل الأيام)
--   time_from / time_to  بالدقائق من منتصف الليل (قد تعبر منتصف الليل)
--   usage_since  تُعدّ حدود الاستخدام من هذا الوقت، لا من أول فاتورة في تاريخ الرمز
-- reciepts.discount_qr_violation  سبب مخالفة الشروط: الفاتورة تُحفظ دائماً (قد تكون بيعت دون اتصال) وتظهر للمراجعة.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF COL_LENGTH('ext_discount_qr_people', 'max_percent') IS NULL
    ALTER TABLE ext_discount_qr_people ADD
        max_percent DECIMAL(5,2) NULL,
        max_amount DECIMAL(18,2) NULL,
        min_invoice DECIMAL(18,2) NULL,
        weekdays INT NULL,
        time_from INT NULL,
        time_to INT NULL,
        valid_from DATE NULL,
        valid_to DATE NULL,
        max_uses INT NULL,
        max_uses_per_day INT NULL,
        budget_total DECIMAL(18,2) NULL,
        budget_month DECIMAL(18,2) NULL,
        allow_gift BIT NOT NULL CONSTRAINT DF_ext_discount_qr_people_gift DEFAULT 1,
        note NVARCHAR(300) NULL,
        usage_since DATETIME NULL;
GO
IF COL_LENGTH('reciepts', 'discount_qr_violation') IS NULL
    ALTER TABLE reciepts ADD discount_qr_violation NVARCHAR(300) NULL;
GO
