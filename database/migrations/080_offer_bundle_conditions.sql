-- شروط تفعيل العرض المشروط (النوع 1).
-- بلا صف = السلوك القديم: كل المواد المشروطة يجب أن تكون في الفاتورة (قطعة واحدة لكل مادة).
--   match_mode          0 = كل المواد المشروطة · 1 = عدد منها (min_count)
--   count_basis         0 = مواد مختلفة · 1 = عدد قطع (يُسمح بتكرار نفس المادة)
--   min_qty_each        أقل كمية لكل مادة كي تُحسب
--   min_required_amount أقل قيمة لمجموع المواد المشروطة في الفاتورة (0 = بلا حد)
--   required_discount   خصم نسبة على المواد المشروطة نفسها عند تحقق الشرط (0 = بلا خصم)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ext_offer_bundle_conditions')
CREATE TABLE ext_offer_bundle_conditions (
    offer_id             BIGINT NOT NULL,
    match_mode           TINYINT NOT NULL CONSTRAINT DF_obc_match_mode DEFAULT 0,
    min_count            INT NOT NULL CONSTRAINT DF_obc_min_count DEFAULT 0,
    count_basis          TINYINT NOT NULL CONSTRAINT DF_obc_count_basis DEFAULT 0,
    min_qty_each         DECIMAL(18,3) NOT NULL CONSTRAINT DF_obc_min_qty_each DEFAULT 1,
    min_required_amount  DECIMAL(18,2) NOT NULL CONSTRAINT DF_obc_min_amount DEFAULT 0,
    required_discount    DECIMAL(18,2) NOT NULL CONSTRAINT DF_obc_required_discount DEFAULT 0,
    updated_at           DATETIME2 NOT NULL CONSTRAINT DF_obc_updated DEFAULT GETDATE(),
    CONSTRAINT PK_ext_offer_bundle_conditions PRIMARY KEY (offer_id)
);
GO
