-- العضوية الديناميكية للأشجار: استبعاد فردي + تتبع آخر مزامنة عضوية
USE [FOT_POS_V2];
GO

-- استبعاد صنف منفرد من دفعة شجرة داخل عرض (يبقى مستثنى عند تحديث العضوية تلقائياً)
IF COL_LENGTH('offer_details', 'excluded') IS NULL
    ALTER TABLE offer_details ADD excluded BIT NOT NULL CONSTRAINT DF_offer_details_excluded DEFAULT 0;
GO

-- آخر مرة حُدّثت عضوية هذه الدفعة (يضبطها المحدّث التلقائي/اليدوي)
IF COL_LENGTH('offer_details', 'tree_synced_at') IS NULL
    ALTER TABLE offer_details ADD tree_synced_at DATETIME2 NULL;
GO

-- نفس المفهوم لمجموعات العمولة
IF COL_LENGTH('ext_commission_group_items', 'excluded') IS NULL
    ALTER TABLE ext_commission_group_items ADD excluded BIT NOT NULL CONSTRAINT DF_cgi_excluded DEFAULT 0;
GO

IF COL_LENGTH('ext_commission_group_items', 'tree_synced_at') IS NULL
    ALTER TABLE ext_commission_group_items ADD tree_synced_at DATETIME2 NULL;
GO

IF COL_LENGTH('ext_commission_group_trees', 'last_synced_at') IS NULL
    ALTER TABLE ext_commission_group_trees ADD last_synced_at DATETIME2 NULL;
GO

-- فهرس دفعات الأشجار (تسريع التوسيع والمزامنة)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_offer_details_tree_inc' AND object_id = OBJECT_ID('offer_details')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_offer_details_tree_inc
        ON offer_details (source_tree_seq, offer_id)
        INCLUDE (item_id, discount, excluded)
        WHERE source_tree_seq IS NOT NULL;
END
GO
