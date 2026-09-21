-- Fix garbled admin display name + section/branch labels after Edari ADO encoding
USE [FOT_POS_V2];
GO

UPDATE ext_users
SET display_name = N'مدير النظام'
WHERE username = 'admin';

-- Readable numeric Edari branch names stay; garbled ones get stable labels
UPDATE eb SET eb.name = CASE eb.erp_seq
    WHEN 1 THEN N'138'
    WHEN 2 THEN N'136'
    WHEN 4 THEN N'2'
    ELSE N'فرع Edari ' + CAST(eb.erp_seq AS NVARCHAR(20))
END
FROM edari_branches eb
WHERE eb.name LIKE N'%?%' OR eb.name LIKE N'%#%' OR eb.name IS NULL;

UPDATE b SET b.name = eb.name
FROM branches b
INNER JOIN sections s ON s.branch_id = b.id
INNER JOIN edari_branches eb ON eb.erp_seq = s.edari_branch_id;

UPDATE s SET s.name = eb.name
FROM sections s
INNER JOIN edari_branches eb ON eb.erp_seq = s.edari_branch_id;

PRINT 'Names fixed.';
GO
