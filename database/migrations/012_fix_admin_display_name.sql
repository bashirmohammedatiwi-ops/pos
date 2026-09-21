-- إصلاح اسم العرض العربي للمستخدم admin (ترميز تالف في بعض التثبيتات)
UPDATE ext_users
SET display_name = N'مدير النظام'
WHERE username = 'admin'
  AND display_name <> N'مدير النظام';
