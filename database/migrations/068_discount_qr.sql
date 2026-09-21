-- رموز QR لاعتماد خصم الفاتورة دون حد، مع ربط الفاتورة بالشخص.

USE [FOT_POS_V2];
GO

IF OBJECT_ID('dbo.ext_discount_qr_people', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ext_discount_qr_people (
        id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ext_discount_qr_people PRIMARY KEY,
        name NVARCHAR(200) NOT NULL,
        code NVARCHAR(32) NOT NULL,
        active BIT NOT NULL CONSTRAINT DF_ext_discount_qr_people_active DEFAULT 1,
        created_at DATETIME NOT NULL CONSTRAINT DF_ext_discount_qr_people_created DEFAULT GETDATE()
    );
    CREATE UNIQUE INDEX UX_ext_discount_qr_people_code ON dbo.ext_discount_qr_people (code);
END
GO

IF COL_LENGTH('reciepts', 'discount_qr_person_id') IS NULL
    ALTER TABLE reciepts ADD discount_qr_person_id BIGINT NULL;
GO

IF COL_LENGTH('reciepts', 'discount_qr_person_name') IS NULL
    ALTER TABLE reciepts ADD discount_qr_person_name NVARCHAR(200) NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_reciepts_discount_qr_person_id'
      AND object_id = OBJECT_ID('reciepts')
)
    CREATE INDEX IX_reciepts_discount_qr_person_id ON reciepts (discount_qr_person_id)
    WHERE discount_qr_person_id IS NOT NULL;
GO
