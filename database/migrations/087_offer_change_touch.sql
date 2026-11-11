-- أُلغيت triggers العروض التي أضافها إصدار 2.4.12: أي trigger على offers أو offer_details
-- يجعل SQL Server يرفض UPDATE/INSERT ... OUTPUT INSERTED دون INTO، وكود العروض يستخدمها
-- (قائمة العروض، إيقاف العروض المنتهية، إضافة بند)، فتوقف قسم العروض ومزامنة الإداري.
-- تحريك المواد المتأثرة صار في الكود: بعد الحذف (OfferRepository.TouchArticlesAsync)،
-- عند انضمام صنف لشجرة عرض، ومهمة بداية/نهاية العروض اليومية.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
DROP TRIGGER IF EXISTS dbo.trg_offer_details_touch_articles;
GO
DROP TRIGGER IF EXISTS dbo.trg_offers_touch_articles;
GO
