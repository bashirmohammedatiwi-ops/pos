-- Edari 2025 — تسعير شجرة العطور اعتماداً على سعر التكلفة (File13n.Last)
-- استثناء: تكلفة < 25,000 لا يتغير SellPr4
-- تقريب السعر الجديد لأقرب 250 د.ع

SELECT
  f.Seq,
  COALESCE(NULLIF(f.Barcode, ''), f.Num) AS Barcode,
  f.Name1,
  f.Last AS CostPrice,
  f.SellPr4 AS ConsumerBefore,
  CASE
    WHEN f.Last < 25000 THEN f.SellPr4
    ELSE ROUND(
      CASE
        WHEN f.Last < 50000 THEN f.Last * 1.30
        WHEN f.Last <= 100000 THEN f.Last * 1.25
        WHEN f.Last <= 150000 THEN f.Last * 1.20
        WHEN f.Last <= 200000 THEN f.Last * 1.18
        WHEN f.Last <= 250000 THEN f.Last * 1.15
        WHEN f.Last <= 300000 THEN f.Last * 1.12
        ELSE f.Last * 1.10
      END / 250
    ) * 250
  END AS ConsumerAfter
FROM File13n f
WHERE NOT EXISTS (SELECT 1 FROM File13n c WHERE c.Father = f.Seq)
  AND (
    f.Father = 90543
    OR f.Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
    OR f.Father IN (
      SELECT Seq FROM File13n WHERE Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
    )
    OR f.Father IN (
      SELECT Seq FROM File13n WHERE Father IN (
        SELECT Seq FROM File13n WHERE Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
      )
    )
  )
  AND f.Last > 0
ORDER BY f.Seq;

-- UPDATE (نُفّذ عبر EdariPerfumeProbe):
/*
UPDATE File13n f
SET SellPr4 = ROUND(
  CASE
    WHEN f.Last < 50000 THEN f.Last * 1.30
    WHEN f.Last <= 100000 THEN f.Last * 1.25
    WHEN f.Last <= 150000 THEN f.Last * 1.20
    WHEN f.Last <= 200000 THEN f.Last * 1.18
    WHEN f.Last <= 250000 THEN f.Last * 1.15
    WHEN f.Last <= 300000 THEN f.Last * 1.12
    ELSE f.Last * 1.10
  END / 250
) * 250
WHERE ... شجرة العطور ... AND f.Last >= 25000;
*/
