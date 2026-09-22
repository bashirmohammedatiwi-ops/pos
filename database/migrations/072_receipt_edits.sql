-- سجل تعديلات الفواتير المؤجلة: قبل / بعد لكل حفظ
IF OBJECT_ID(N'dbo.ext_receipt_edits', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_receipt_edits (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_receipt_edits PRIMARY KEY,
        receipt_id BIGINT NOT NULL,
        edited_at DATETIME2 NOT NULL CONSTRAINT DF_ext_receipt_edits_at DEFAULT GETDATE(),
        before_json NVARCHAR(MAX) NOT NULL,
        after_json NVARCHAR(MAX) NOT NULL
    );
    CREATE INDEX IX_ext_receipt_edits_receipt ON dbo.ext_receipt_edits (receipt_id, id);
END
GO
