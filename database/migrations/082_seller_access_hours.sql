-- أوقات فتح ويب البائعين لكل بائع (بتوقيت العراق UTC+3)
-- access_from_min / access_to_min: دقائق من بداية اليوم (0..1439). NULL = بلا تقييد.
-- إذا كانت النهاية أصغر من البداية فالنافذة تعبر منتصف الليل.
-- access_days: قناع أيام — بت 0 = السبت … بت 6 = الجمعة (127 = كل الأيام).
IF COL_LENGTH('ext_seller_accounts', 'access_from_min') IS NULL
    ALTER TABLE ext_seller_accounts ADD access_from_min SMALLINT NULL;
GO
IF COL_LENGTH('ext_seller_accounts', 'access_to_min') IS NULL
    ALTER TABLE ext_seller_accounts ADD access_to_min SMALLINT NULL;
GO
IF COL_LENGTH('ext_seller_accounts', 'access_days') IS NULL
    ALTER TABLE ext_seller_accounts ADD access_days TINYINT NOT NULL CONSTRAINT DF_ext_seller_accounts_days DEFAULT (127);
GO
