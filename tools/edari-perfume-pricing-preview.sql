-- Edari 2025 — معاينة تسعير شجرة العطور (Seq 90543)
-- آخر شراء = File14n.Price * File14n.Equa  (Kind = 1)
-- تقريب السعر الجديد لأقرب 250 د.ع

SELECT
  f.Seq,
  COALESCE(NULLIF(f.Barcode, ''), f.Num) AS Barcode,
  f.Name1,
  lp.LastBuy AS LastPurchasePrice,
  f.SellPr4 AS ConsumerBefore,
  ROUND(
    CASE
      WHEN lp.LastBuy < 50000 THEN lp.LastBuy * 1.30
      WHEN lp.LastBuy <= 100000 THEN lp.LastBuy * 1.25
      WHEN lp.LastBuy <= 150000 THEN lp.LastBuy * 1.20
      WHEN lp.LastBuy <= 200000 THEN lp.LastBuy * 1.18
      WHEN lp.LastBuy <= 250000 THEN lp.LastBuy * 1.15
      WHEN lp.LastBuy <= 300000 THEN lp.LastBuy * 1.12
      ELSE lp.LastBuy * 1.10
    END / 250
  ) * 250 AS ConsumerAfter,
  ROUND(
    CASE
      WHEN lp.LastBuy < 50000 THEN lp.LastBuy * 1.30
      WHEN lp.LastBuy <= 100000 THEN lp.LastBuy * 1.25
      WHEN lp.LastBuy <= 150000 THEN lp.LastBuy * 1.20
      WHEN lp.LastBuy <= 200000 THEN lp.LastBuy * 1.18
      WHEN lp.LastBuy <= 250000 THEN lp.LastBuy * 1.15
      WHEN lp.LastBuy <= 300000 THEN lp.LastBuy * 1.12
      ELSE lp.LastBuy * 1.10
    END / 250
  ) * 250 - f.SellPr4 AS PriceDiff
FROM File13n f
INNER JOIN (
  SELECT l.Mat, l.Price * l.Equa AS LastBuy
  FROM File14n l
  INNER JOIN (
    SELECT Mat, MAX(Seq) AS MaxSeq
    FROM File14n
    WHERE Kind = 1
    GROUP BY Mat
  ) x ON x.Mat = l.Mat AND x.MaxSeq = l.Seq
) lp ON lp.Mat = f.Seq
WHERE NOT EXISTS (SELECT 1 FROM File13n c WHERE c.Father = f.Seq)
  AND (
    f.Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
    OR f.Father IN (
      SELECT Seq FROM File13n WHERE Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
    )
    OR f.Father IN (
      SELECT Seq FROM File13n WHERE Father IN (
        SELECT Seq FROM File13n WHERE Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
      )
    )
  )
  AND lp.LastBuy > 0
ORDER BY f.Seq;

-- لعرض المنتجات التي سيتغير سعرها فقط، أضف في النهاية:
-- AND ROUND( ... نفس CASE ... / 250) * 250 <> f.SellPr4

-- UPDATE (لا تنفّذ إلا بعد نسخة احتياطية وموافقة صريحة):
/*
UPDATE File13n f
SET SellPr4 = (
  SELECT ROUND(
    CASE
      WHEN lp.LastBuy < 50000 THEN lp.LastBuy * 1.30
      WHEN lp.LastBuy <= 100000 THEN lp.LastBuy * 1.25
      WHEN lp.LastBuy <= 150000 THEN lp.LastBuy * 1.20
      WHEN lp.LastBuy <= 200000 THEN lp.LastBuy * 1.18
      WHEN lp.LastBuy <= 250000 THEN lp.LastBuy * 1.15
      WHEN lp.LastBuy <= 300000 THEN lp.LastBuy * 1.12
      ELSE lp.LastBuy * 1.10
    END / 250
  ) * 250
  FROM (
    SELECT l.Mat, l.Price * l.Equa AS LastBuy
    FROM File14n l
    INNER JOIN (
      SELECT Mat, MAX(Seq) AS MaxSeq FROM File14n WHERE Kind = 1 GROUP BY Mat
    ) x ON x.Mat = l.Mat AND x.MaxSeq = l.Seq
  ) lp
  WHERE lp.Mat = f.Seq AND lp.LastBuy > 0
)
WHERE EXISTS (
  SELECT 1
  FROM File14n l
  INNER JOIN (
    SELECT Mat, MAX(Seq) AS MaxSeq FROM File14n WHERE Kind = 1 GROUP BY Mat
  ) x ON x.Mat = l.Mat AND x.MaxSeq = l.Seq
  WHERE l.Mat = f.Seq AND l.Price * l.Equa > 0
)
AND NOT EXISTS (SELECT 1 FROM File13n c WHERE c.Father = f.Seq)
AND (
  f.Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
  OR f.Father IN (
    SELECT Seq FROM File13n WHERE Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
  )
  OR f.Father IN (
    SELECT Seq FROM File13n WHERE Father IN (
      SELECT Seq FROM File13n WHERE Father IN (SELECT Seq FROM File13n WHERE Father = 90543)
    )
  )
);
*/
