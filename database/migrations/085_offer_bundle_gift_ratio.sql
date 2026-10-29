-- العرض المشروط: عدد القطع المخفّضة (الهدايا) مقابل القطع المدفوعة من المواد المشروطة.
--   gift_every  كل كم قطعة مدفوعة من المواد المشروطة (0 = بلا حد — السلوك القديم: كل القطع المخفّضة)
--   gift_count  كم قطعة مخفّضة مقابلها — «قطعة + قطعة هدية» = 1 و 1 · «2 + 1» = 2 و 1
-- القطعة التي تكون مشروطة ومخفّضة معاً (هدية من نفس الشجرة) تُحسب هدية فقط بعد تحقق الشرط بقطع أخرى.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF COL_LENGTH('ext_offer_bundle_conditions', 'gift_every') IS NULL
    ALTER TABLE ext_offer_bundle_conditions ADD gift_every INT NOT NULL CONSTRAINT DF_obc_gift_every DEFAULT 0;
GO
IF COL_LENGTH('ext_offer_bundle_conditions', 'gift_count') IS NULL
    ALTER TABLE ext_offer_bundle_conditions ADD gift_count INT NOT NULL CONSTRAINT DF_obc_gift_count DEFAULT 0;
GO
