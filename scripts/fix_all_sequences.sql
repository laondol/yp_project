-- Fix all tables missing auto-increment on id column (pgloader migration gap)
DO $$
DECLARE
  rec RECORD;
  seq_name TEXT;
BEGIN
  FOR rec IN
    SELECT c.relname AS tbl
    FROM pg_class c
    WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped)
  LOOP
    BEGIN
      IF pg_get_serial_sequence(rec.tbl, 'id') IS NULL THEN
        seq_name := rec.tbl || '_id_seq';
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I OWNED BY %I.id', seq_name, rec.tbl);
        EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(id) FROM %I), 0) + 1, false)', seq_name, rec.tbl);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT nextval(%L)', rec.tbl, seq_name);
        RAISE NOTICE 'Fixed sequence for %', rec.tbl;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipped %: %', rec.tbl, SQLERRM;
    END;
  END LOOP;
END;
$$;
