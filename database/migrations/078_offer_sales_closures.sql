-- Auto-generated offer-period sales reports when a dated offer is disabled after expiry.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_offer_sales_closures')
CREATE TABLE ext_offer_sales_closures (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    offer_id        BIGINT NOT NULL,
    offer_name      NVARCHAR(500) NOT NULL,
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL,
    closed_at       DATETIME2 NOT NULL CONSTRAINT DF_ext_osc_closed DEFAULT GETDATE(),
    CONSTRAINT PK_ext_offer_sales_closures PRIMARY KEY (id),
    CONSTRAINT UQ_ext_osc_offer UNIQUE (offer_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ext_osc_closed' AND object_id = OBJECT_ID('ext_offer_sales_closures'))
    CREATE INDEX IX_ext_osc_closed ON ext_offer_sales_closures (closed_at DESC);
GO
