-- Reset sort_num backfill — only Edari sync assigns order (File11n ORDER BY Num, Name1).
UPDATE salesmen SET sort_num = NULL;
