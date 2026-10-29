-- Migration 6: metadata diagnosis only. PREPARED; NEVER EXECUTED HERE.
-- Run the whole file manually only after review, on the intended project.
-- Assumes PostgreSQL 17 and the already reviewed catalog-only environment.
-- No business rows, full definitions, application calls or changes to objects.
-- OIDs/fingerprints are internal metadata; keep results internal.
-- Missing rows/NULL are not success. Stop on error/timeout; ROLLBACK if open.
-- Results describe CURRENT_USER, not a future migration executor or SET ROLE.
-- Fingerprints need reviewed references; they do not prove behavior or safety.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- M6-01: executor flags. BYPASSRLS alone does not authorize DDL.
SELECT 'M6-01' AS check_id, r.oid AS executor_oid,
       r.rolsuper, r.rolbypassrls, r.rolinherit, r.rolcreaterole
FROM pg_catalog.pg_roles r WHERE r.rolname = CURRENT_USER;

-- M6-02: required schemas; flags are effective privileges of CURRENT_USER.
WITH expected(name) AS (VALUES ('public'), ('private'))
SELECT 'M6-02' AS check_id, e.name AS schema_name,
       n.oid IS NOT NULL AS present, n.nspowner AS owner_oid,
       pg_catalog.has_schema_privilege(n.oid, 'USAGE') AS executor_usage,
       pg_catalog.has_schema_privilege(n.oid, 'CREATE') AS executor_create
FROM expected e LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = e.name
ORDER BY e.name;

-- M6-03: table ownership and effective TRIGGER privilege, not row access.
WITH expected(name) AS (VALUES ('events'), ('band_members'))
SELECT 'M6-03' AS check_id, e.name AS table_name,
       c.oid IS NOT NULL AS present, c.relkind, c.relowner AS owner_oid,
       pg_catalog.pg_has_role(c.relowner, 'USAGE') AS executor_inherits_owner,
       pg_catalog.has_table_privilege(c.oid, 'TRIGGER') AS executor_trigger
FROM expected e
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = e.name
ORDER BY e.name;

-- M6-04: language exists, is trusted, and permits function creation.
SELECT 'M6-04' AS check_id, l.oid IS NOT NULL AS present,
       l.lanispl, l.lanpltrusted, l.lanowner AS owner_oid,
       pg_catalog.has_language_privilege(l.oid, 'USAGE') AS executor_usage
FROM (VALUES ('plpgsql')) AS expected(name)
LEFT JOIN pg_catalog.pg_language l ON l.lanname = expected.name;

-- M6-05: roles named in REVOKE. PUBLIC is a pseudo-role, not a pg_roles row.
WITH expected(name) AS (VALUES ('anon'), ('authenticated'), ('service_role'))
SELECT 'M6-05' AS check_id, e.name AS role_name,
       r.oid IS NOT NULL AS present, r.oid AS role_oid,
       r.rolsuper, r.rolbypassrls, r.rolcanlogin
FROM expected e LEFT JOIN pg_catalog.pg_roles r ON r.rolname = e.name
ORDER BY e.name;

-- M6-06: all user triggers on the two tables, including unexpected triggers.
-- Standard tgtype bits: ROW=1 BEFORE=2 INSERT=4 DELETE=8 UPDATE=16 TRUNCATE=32.
-- Expected existing names: events_set_updated_at,
-- band_members_prevent_last_admin_removal. Confirm both are actually returned.
SELECT 'M6-06' AS check_id, c.relname AS table_name, t.tgname,
       t.tgenabled, t.tgtype,
       (t.tgtype::integer & 1) <> 0 AS for_each_row,
       (t.tgtype::integer & 2) <> 0 AS before_event,
       (t.tgtype::integer & 16) <> 0 AS on_update,
       (t.tgtype::integer & 8) <> 0 AS on_delete,
       t.tgattr AS update_column_numbers, t.tgnargs,
       t.tgqual IS NOT NULL AS has_when,
       pg_catalog.md5(t.tgqual::text) AS when_fingerprint,
       pg_catalog.md5(t.tgargs::text) AS arguments_fingerprint,
       pn.nspname AS function_schema, p.proname AS function_name,
       t.tgfoid AS function_oid
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
LEFT JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
WHERE n.nspname = 'public' AND c.relname IN ('events','band_members')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- M6-07: linked functions only; no prosrc/proconfig text is returned.
-- An empty search_path is expected for the reviewed helpers; missing setting
-- is distinguishable from a nonempty setting. ACLs are inspected in M6-08.
SELECT DISTINCT 'M6-07' AS check_id, p.oid AS function_oid,
       pn.nspname AS function_schema, p.proname, p.prokind,
       p.proargtypes, p.prorettype, l.lanname, p.proowner AS owner_oid,
       p.prosecdef, p.provolatile, p.proparallel,
       EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS cfg(value)
               WHERE cfg.value LIKE 'search_path=%') AS has_search_path_setting,
       EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) AS cfg(value)
               WHERE cfg.value ~ '^search_path=[[:space:]]*(""[[:space:]]*)?$')
         AS empty_search_path,
       COALESCE('row_security=off' = ANY(p.proconfig), false) AS row_security_off,
       pg_catalog.md5(p.proconfig::text) AS config_fingerprint,
       pg_catalog.md5(p.prosrc) AS body_fingerprint
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
JOIN pg_catalog.pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public' AND c.relname IN ('events','band_members')
  AND NOT t.tgisinternal
ORDER BY function_oid;

-- M6-08: explicit/default ACL entries for linked functions. grantee 0 = PUBLIC.
SELECT DISTINCT 'M6-08' AS check_id, p.oid AS function_oid,
       a.grantor, a.grantee, a.privilege_type, a.is_grantable
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
WHERE n.nspname = 'public' AND c.relname IN ('events','band_members')
  AND NOT t.tgisinternal
ORDER BY function_oid, a.grantee, a.privilege_type;

-- M6-09: function default ACLs for CURRENT_USER, global and private schema.
-- Other creators' defaults do not apply merely because CURRENT_USER is a member.
-- No rows = no custom defaults here; builtin PUBLIC EXECUTE still applies and
-- is revoked by the migration. Unexpected grantees require review: its REVOKE
-- removes PUBLIC/anon/authenticated/service_role, not arbitrary other grants.
SELECT 'M6-09' AS check_id, d.defaclrole AS creator_oid,
       d.defaclnamespace AS schema_oid, d.defaclobjtype,
       a.grantor, a.grantee, a.privilege_type, a.is_grantable
FROM pg_catalog.pg_default_acl d
JOIN pg_catalog.pg_roles r ON r.oid = d.defaclrole AND r.rolname = CURRENT_USER
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
WHERE d.defaclobjtype = 'f'
  AND (d.defaclnamespace = 0 OR n.nspname = 'private')
ORDER BY d.defaclnamespace, a.grantee, a.privilege_type;

-- M6-10: all DDL event triggers, even disabled ones; empty = none cataloged.
-- Enabled handlers can intercept function/trigger creation and REVOKE.
-- Metadata cannot prove handler safety or external/dynamic dependencies.
SELECT 'M6-10' AS check_id, e.evtname, e.evtevent, e.evtenabled,
       e.evttags, e.evtowner AS event_owner_oid,
       p.oid AS function_oid, n.nspname AS function_schema, p.proname,
       p.proowner AS function_owner_oid, p.prosecdef, l.lanname,
       pg_catalog.md5(p.proconfig::text) AS config_fingerprint,
       pg_catalog.md5(p.prosrc) AS body_fingerprint
FROM pg_catalog.pg_event_trigger e
LEFT JOIN pg_catalog.pg_proc p ON p.oid = e.evtfoid
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
ORDER BY e.evtname;

-- No execution tests, data compatibility result, or migration approval implied.
-- Do not bypass name collisions or unknown trigger/handler behavior.
-- The unknown production version 20261004120000 remains unreconciled.
ROLLBACK;
