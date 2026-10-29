-- PREPARED ONLY. Include inside the caller transaction BEFORE any write.
-- Server identity necessarily requires metadata SQL AFTER connecting.
\set ON_ERROR_STOP on
\if :{?bandup_expected_database}
\else
SELECT 1/0 AS missing_explicit_database;
\endif
\if :{?bandup_expected_system_identifier}
\else
SELECT 1/0 AS missing_explicit_cluster;
\endif
SELECT COALESCE(
  pg_catalog.inet_server_addr()='127.0.0.1'::inet
  AND pg_catalog.inet_server_port()=5434
  AND pg_catalog.inet_server_port()<>5433
  AND pg_catalog.current_database()='bandup_publication_compat_test'
  AND :'bandup_expected_database'='bandup_publication_compat_test'
  AND :'bandup_expected_system_identifier'='7701800113631615116'
  AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())='7701800113631615116'
  AND pg_catalog.current_setting('server_version_num')::integer=170011
  AND pg_catalog.current_setting('server_encoding')='UTF8'
  AND SESSION_USER=CURRENT_USER
  AND (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER),false) AS verified
\gset compat_lab_
\if :compat_lab_verified
\else
SELECT 1/0 AS unauthorized_synthetic_lab_target;
\endif
\unset compat_lab_verified
