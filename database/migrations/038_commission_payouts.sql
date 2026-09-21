-- Individual commission payouts (038)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_commission_payouts')
CREATE TABLE ext_commission_payouts (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    salesman_id     BIGINT NOT NULL,
    amount          DECIMAL(18,4) NOT NULL,
    paid_at         DATETIME2 NOT NULL CONSTRAINT DF_ext_cpo_paid DEFAULT GETDATE(),
    note            NVARCHAR(400) NULL,
    voided          BIT NOT NULL CONSTRAINT DF_ext_cpo_void DEFAULT 0,
    created_at      DATETIME2 NOT NULL CONSTRAINT DF_ext_cpo_created DEFAULT GETDATE(),
    CONSTRAINT PK_ext_commission_payouts PRIMARY KEY (id)
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ext_cpo_salesman' AND object_id = OBJECT_ID('ext_commission_payouts'))
    CREATE INDEX IX_ext_cpo_salesman ON ext_commission_payouts(salesman_id, paid_at)
        INCLUDE (amount, voided);
