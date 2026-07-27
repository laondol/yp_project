-- Fix temp_email_verify.id auto-increment
CREATE SEQUENCE IF NOT EXISTS temp_email_verify_id_seq OWNED BY temp_email_verify.id;
SELECT setval('temp_email_verify_id_seq', COALESCE((SELECT MAX(id) FROM temp_email_verify), 0) + 1, false);
ALTER TABLE temp_email_verify ALTER COLUMN id SET DEFAULT nextval('temp_email_verify_id_seq');
