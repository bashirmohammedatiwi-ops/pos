-- POS offers: tree batches + bundle roles
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('offer_details') AND name = 'source_tree_seq')
    ALTER TABLE offer_details ADD source_tree_seq BIGINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('offer_details') AND name = 'detail_role')
    ALTER TABLE offer_details ADD detail_role TINYINT NOT NULL CONSTRAINT DF_offer_details_detail_role DEFAULT 0;
-- detail_role: 0=discounted target, 1=required (bundle), 2=bonus/free

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_offer_details_offer_tree' AND object_id = OBJECT_ID('offer_details'))
    CREATE INDEX IX_offer_details_offer_tree ON offer_details (offer_id, source_tree_seq);
