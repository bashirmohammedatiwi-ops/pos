-- سياسة البائع على الفاتورة.
--
-- 1) hide_salesman_groups: خاصية كاشير. عند تفعيلها تُخفى مجاميع البائعين في نقطة البيع
--    ويُختار بائع واحد للفاتورة كاملة بدل بائع لكل مجموعة أو صنف.
--
-- 2) reciepts.salesman كان يُملأ من البائع الافتراضي الذي يرسله الجهاز عند الدخول، فظهرت
--    فواتير بلا بائع باسم أول بائع، وفواتير بائعها المختار باسم أول بائع أيضاً. الرأس صار
--    يُشتق من أسطر الفاتورة: بائع واحد ⇒ اسمه، أكثر من بائع ⇒ بلا بائع (والتفصيل في الأسطر).
--    هذا التصحيح يعيد ضبط الفواتير القديمة على نفس القاعدة.

USE [FOT_POS_V2];
GO

IF COL_LENGTH('cashiers_permissions', 'hide_salesman_groups') IS NULL
    ALTER TABLE cashiers_permissions
        ADD hide_salesman_groups BIT NOT NULL CONSTRAINT DF_cp_hide_salesman_groups DEFAULT 0;
GO

-- الفواتير التي كل أسطرها بلا بائع: الرأس يجب أن يكون بلا بائع كذلك.
UPDATE r
SET r.salesman = 0
FROM reciepts r
WHERE r.salesman <> 0
  AND EXISTS (SELECT 1 FROM reciept_items ri WHERE ri.reciept_id = r.id)
  AND NOT EXISTS (
        SELECT 1 FROM reciept_items ri
        WHERE ri.reciept_id = r.id AND COALESCE(ri.salesman_id, 0) > 0);
GO

-- الفواتير التي لأسطرها بائع واحد مختلف عن الرأس: الرأس يتبع الأسطر.
UPDATE r
SET r.salesman = x.OnlySalesman
FROM reciepts r
INNER JOIN (
    SELECT ri.reciept_id,
           MIN(COALESCE(ri.salesman_id, 0)) AS OnlySalesman
    FROM reciept_items ri
    WHERE COALESCE(ri.salesman_id, 0) > 0
    GROUP BY ri.reciept_id
    HAVING COUNT(DISTINCT COALESCE(ri.salesman_id, 0)) = 1
) x ON x.reciept_id = r.id
WHERE r.salesman <> x.OnlySalesman;
GO

-- الفواتير متعددة الباعة: الرأس بلا بائع، والتفصيل يبقى على الأسطر (ولا بائع للإداري).
UPDATE r
SET r.salesman = 0
FROM reciepts r
INNER JOIN (
    SELECT ri.reciept_id
    FROM reciept_items ri
    WHERE COALESCE(ri.salesman_id, 0) > 0
    GROUP BY ri.reciept_id
    HAVING COUNT(DISTINCT COALESCE(ri.salesman_id, 0)) > 1
) m ON m.reciept_id = r.id
WHERE r.salesman <> 0;
GO
