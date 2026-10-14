-- Organizational folders for offers (admin UI only — does not affect POS pricing).
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_offer_folders')
CREATE TABLE ext_offer_folders (
    id          BIGINT IDENTITY(1,1) NOT NULL,
    name        NVARCHAR(200) NOT NULL,
    sort_order  INT NOT NULL CONSTRAINT DF_ext_offer_folders_sort DEFAULT 0,
    created_at  DATETIME2 NOT NULL CONSTRAINT DF_ext_offer_folders_created DEFAULT GETDATE(),
    CONSTRAINT PK_ext_offer_folders PRIMARY KEY (id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('offers') AND name = 'folder_id')
BEGIN
    ALTER TABLE offers ADD folder_id BIGINT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_offers_folder')
BEGIN
    ALTER TABLE offers
        ADD CONSTRAINT FK_offers_folder
        FOREIGN KEY (folder_id) REFERENCES ext_offer_folders (id)
        ON DELETE SET NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_offers_folder' AND object_id = OBJECT_ID('offers'))
    CREATE INDEX IX_offers_folder ON offers (folder_id);
GO
