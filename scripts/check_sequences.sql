WITH tables_with_id AS (
  SELECT c.relname
  FROM pg_class c
  WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND c.relkind = 'r'
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped)
)
SELECT t.relname
FROM tables_with_id t
WHERE pg_get_serial_sequence(t.relname, 'id') IS NULL
ORDER BY t.relname;
