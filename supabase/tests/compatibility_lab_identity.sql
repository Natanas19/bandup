-- PREPARED ONLY. Read-only gate, before artifacts in the SAME psql connection.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
\ir compatibility_lab_identity_check.sql
ROLLBACK;
