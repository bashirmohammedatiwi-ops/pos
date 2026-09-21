-- Hot-path indexes for catalog sync, receipts, and Edari queue (037)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reciepts_unsynced' AND object_id = OBJECT_ID('reciepts'))
    CREATE INDEX IX_reciepts_unsynced ON reciepts(synced, is_pending)
        INCLUDE (id, creation_date)
        WHERE synced = 0 AND is_pending = 0;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reciepts_creation_date' AND object_id = OBJECT_ID('reciepts'))
    CREATE INDEX IX_reciepts_creation_date ON reciepts(creation_date)
        INCLUDE (is_pending, kind, total_amount, synced, cashier_id, point_of_sale_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reciept_items_receipt' AND object_id = OBJECT_ID('reciept_items'))
    CREATE INDEX IX_reciept_items_receipt ON reciept_items(reciept_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_articles_seq' AND object_id = OBJECT_ID('articles'))
    CREATE INDEX IX_articles_seq ON articles(Seq);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_articles_barcode' AND object_id = OBJECT_ID('articles'))
    CREATE INDEX IX_articles_barcode ON articles(Barcode) WHERE Barcode IS NOT NULL AND Barcode <> N'';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_articles_father' AND object_id = OBJECT_ID('articles'))
    CREATE INDEX IX_articles_father ON articles(Father);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_articles_sellpr4' AND object_id = OBJECT_ID('articles'))
    CREATE INDEX IX_articles_sellpr4 ON articles(SellPr4) WHERE SellPr4 > 0;
