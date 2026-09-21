-- Backfill reciepts.master_account from cashier section default cash box (FOT_POS_V2)
USE [FOT_POS_V2];
GO

UPDATE r
SET r.master_account = sc.master_account
FROM reciepts r
INNER JOIN cashiers c ON c.id = r.cashier_id
INNER JOIN section_cashboxes sc ON sc.section_id = c.section_id AND sc.is_default = 1
WHERE COALESCE(r.master_account, 0) = 0
  AND COALESCE(r.is_pending, 0) = 0
  AND sc.master_account > 0;
GO
