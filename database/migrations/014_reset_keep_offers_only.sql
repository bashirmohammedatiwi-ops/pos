-- إعادة ضبط التطبيق: الإبقاء على العروض فقط — باقي البيانات من Edari
USE [FOT_POS_V2];
GO

SET NOCOUNT ON;
BEGIN TRANSACTION;

BEGIN TRY
    PRINT '=== قبل التنظيف ===';
    SELECT 'reciepts' AS t, COUNT(*) AS c FROM reciepts
    UNION ALL SELECT 'reciept_items', COUNT(*) FROM reciept_items
    UNION ALL SELECT 'offers', COUNT(*) FROM offers
    UNION ALL SELECT 'offer_details', COUNT(*) FROM offer_details
    UNION ALL SELECT 'articles', COUNT(*) FROM articles
    UNION ALL SELECT 'salesmen', COUNT(*) FROM salesmen
    UNION ALL SELECT 'sections', COUNT(*) FROM sections;

    -- ── 1. الفواتير وسجل الترحيل ──
    DELETE FROM reciept_credit_card;
    DELETE FROM reciept_items;
    DELETE FROM reciepts;
    DELETE FROM ext_edari_sync_log;

    -- ── 2. سجلات النشاط والعمولات والأهداف المحسوبة ──
    IF OBJECT_ID('ext_commission_calculations', 'U') IS NOT NULL DELETE FROM ext_commission_calculations;
    IF OBJECT_ID('ext_target_progress', 'U') IS NOT NULL DELETE FROM ext_target_progress;
    IF OBJECT_ID('ext_pos_logs', 'U') IS NOT NULL DELETE FROM ext_pos_logs;
    IF OBJECT_ID('pos_log', 'U') IS NOT NULL DELETE FROM pos_log;
    IF OBJECT_ID('users_log', 'U') IS NOT NULL DELETE FROM users_log;

    -- ── 3. إعدادات POS المحلية (تُجلب من Edari) ──
    IF OBJECT_ID('vouchers', 'U') IS NOT NULL DELETE FROM vouchers;
    IF OBJECT_ID('sections_vouchers_groups', 'U') IS NOT NULL DELETE FROM sections_vouchers_groups;
    IF OBJECT_ID('sections_offers', 'U') IS NOT NULL DELETE FROM sections_offers;
    IF OBJECT_ID('sections_bills', 'U') IS NOT NULL DELETE FROM sections_bills;
    IF OBJECT_ID('sections_articles', 'U') IS NOT NULL DELETE FROM sections_articles;
    IF OBJECT_ID('sections_article_groups', 'U') IS NOT NULL DELETE FROM sections_article_groups;
    IF OBJECT_ID('sections_cashiers', 'U') IS NOT NULL DELETE FROM sections_cashiers;
    IF OBJECT_ID('sections_print_options', 'U') IS NOT NULL DELETE FROM sections_print_options;
    IF OBJECT_ID('sections_salesmen', 'U') IS NOT NULL DELETE FROM sections_salesmen;
    IF OBJECT_ID('point_of_sales', 'U') IS NOT NULL DELETE FROM point_of_sales;
    IF OBJECT_ID('sections', 'U') IS NOT NULL DELETE FROM sections;
    IF OBJECT_ID('cashiers', 'U') IS NOT NULL DELETE FROM cashiers;
    IF OBJECT_ID('cashiers_permissions', 'U') IS NOT NULL DELETE FROM cashiers_permissions;

    -- ── 4. المنتجات والبائعون والحسابات (نسخ محلية — المصدر Edari) ──
    IF OBJECT_ID('article_group_items', 'U') IS NOT NULL DELETE FROM article_group_items;
    IF OBJECT_ID('article_barcodes', 'U') IS NOT NULL DELETE FROM article_barcodes;
    IF OBJECT_ID('articles', 'U') IS NOT NULL DELETE FROM articles;
    IF OBJECT_ID('article_groups', 'U') IS NOT NULL DELETE FROM article_groups;
    IF OBJECT_ID('salesmen', 'U') IS NOT NULL DELETE FROM salesmen;
    IF OBJECT_ID('accounts', 'U') IS NOT NULL DELETE FROM accounts;
    IF OBJECT_ID('delivery_clients', 'U') IS NOT NULL DELETE FROM delivery_clients;
    IF OBJECT_ID('warehouses', 'U') IS NOT NULL DELETE FROM warehouses;
    IF OBJECT_ID('branches', 'U') IS NOT NULL DELETE FROM branches;
    IF OBJECT_ID('edari_branches', 'U') IS NOT NULL DELETE FROM edari_branches;

    -- ── 5. قواعد العمولات والأهداف (إعدادات — ليس العروض) ──
    IF OBJECT_ID('ext_target_rule_trees', 'U') IS NOT NULL DELETE FROM ext_target_rule_trees;
    IF OBJECT_ID('ext_target_assignments', 'U') IS NOT NULL DELETE FROM ext_target_assignments;
    IF OBJECT_ID('ext_target_rules', 'U') IS NOT NULL DELETE FROM ext_target_rules;
    IF OBJECT_ID('ext_commission_rules', 'U') IS NOT NULL DELETE FROM ext_commission_rules;
    IF OBJECT_ID('ext_salesman_commission_profiles', 'U') IS NOT NULL DELETE FROM ext_salesman_commission_profiles;
    IF OBJECT_ID('ext_employee_products', 'U') IS NOT NULL DELETE FROM ext_employee_products;

    COMMIT TRANSACTION;

    PRINT '';
    PRINT '=== بعد التنظيف (المتبقي) ===';
    SELECT 'reciepts' AS t, COUNT(*) AS c FROM reciepts
    UNION ALL SELECT 'reciept_items', COUNT(*) FROM reciept_items
    UNION ALL SELECT 'offers', COUNT(*) FROM offers
    UNION ALL SELECT 'offer_details', COUNT(*) FROM offer_details
    UNION ALL SELECT 'articles', COUNT(*) FROM articles
    UNION ALL SELECT 'salesmen', COUNT(*) FROM salesmen
    UNION ALL SELECT 'sections', COUNT(*) FROM sections
    UNION ALL SELECT 'ext_edari_sync_log', COUNT(*) FROM ext_edari_sync_log;

    PRINT '';
    PRINT 'تم — العروض محفوظة. زامِن البائعين والمنتجات من Edari.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH
GO
