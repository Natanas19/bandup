-- PHASE 1: STRUCTURAL METADATA ONLY. PREPARED, NOT EXECUTED.
-- Read supabase-production-readonly.md. Future target-specific approval required.
-- Catalogs only: no ledger rows, business tables/views, deparsers or application calls.
-- Fresh dedicated PostgreSQL 15+ session; stop on first error; no automatic retries.
-- This file never includes or invokes the separately authorized data phase.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- A1: session capabilities, not proof of the intended Supabase project identity.
SELECT pg_catalog.current_setting('transaction_read_only') = 'on' AS read_only,
       pg_catalog.current_setting('server_version_num')::integer AS server_version_num,
       pg_catalog.current_setting('server_encoding') AS encoding,
       pg_catalog.current_setting('TimeZone') AS timezone,
       pg_catalog.statement_timestamp() AS diagnostic_time,
       r.oid AS executor_role_oid, r.rolsuper, r.rolbypassrls,
       pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'CONNECT') AS can_connect,
       pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'TEMP') AS can_temp_for_future_migration
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;

-- A2: presence inventory; no failing cast when an expected object is absent.
WITH expected(schema_name, relation_name) AS (VALUES
 ('public','bands'), ('public','band_members'), ('public','social_links'),
 ('public','tasks'), ('public','events'), ('public','public_band_profiles'),
 ('supabase_migrations','schema_migrations'))
SELECT e.schema_name, e.relation_name, c.oid IS NOT NULL AS present,
       c.relkind, c.relam AS access_method_oid, c.relowner AS owner_oid,
       c.relrowsecurity, c.relforcerowsecurity,
       CASE WHEN c.relkind IN ('r','p','v','m','f') THEN pg_catalog.has_table_privilege(c.oid,'SELECT') END AS executor_select,
       CASE WHEN c.relkind = 'r' THEN pg_catalog.row_security_active(c.oid) END AS executor_rls_active
FROM expected e LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.relation_name
ORDER BY 1,2;

-- A3: schema owners and actual ACL entries (grantee 0 means PUBLIC).
SELECT n.nspname, n.nspowner AS owner_oid, a.grantee AS grantee_oid,
       a.privilege_type, a.is_grantable,
       pg_catalog.has_schema_privilege(n.oid,'USAGE') AS executor_usage,
       pg_catalog.has_schema_privilege(n.oid,'CREATE') AS executor_create_for_future_migration
FROM pg_catalog.pg_namespace n LEFT JOIN LATERAL
 pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a ON true
WHERE n.nspname IN ('public','private','supabase_migrations') ORDER BY 1,3,4;

-- A4: relevant relations and view; safe flags instead of arbitrary reloption text.
SELECT n.nspname, c.relname, c.oid, c.relowner AS owner_oid, c.relkind,
       c.relrowsecurity, c.relforcerowsecurity,
       c.reloptions @> ARRAY['security_barrier=true'] AS security_barrier,
       c.reloptions @> ARRAY['security_invoker=false'] AS owner_context_explicit,
       pg_catalog.cardinality(c.reloptions) AS option_count,
       a.grantee AS grantee_oid, a.privilege_type, a.is_grantable,
       (SELECT pg_catalog.count(*) FROM pg_catalog.pg_rewrite w WHERE w.ev_class=c.oid) AS rewrite_rule_count,
       CASE WHEN c.relkind='v' THEN
        (SELECT pg_catalog.md5(pg_catalog.string_agg(w.ev_action::text || ':' || w.ev_qual::text, '|' ORDER BY w.oid))
         FROM pg_catalog.pg_rewrite w WHERE w.ev_class=c.oid) END AS view_tree_fingerprint
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a ON true
WHERE n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events','public_band_profiles')
ORDER BY 2,11,12;

-- A5: columns/types/nullability/default fingerprints and explicit column ACLs.
-- No raw defaults: unexpected defaults can embed credentials or personal values.
SELECT c.relname, a.attnum, a.attname, a.atttypid AS type_oid, a.atttypmod,
       tn.nspname AS type_schema, ty.typname, ty.typtype, ty.typbasetype,
       ty.typinput AS input_function_oid, ty.typoutput AS output_function_oid,
       a.attcollation AS collation_oid,
       a.attnotnull, a.attidentity, a.attgenerated,
       pg_catalog.md5(d.adbin::text) AS default_tree_fingerprint,
       x.grantee AS column_grantee_oid, x.privilege_type, x.is_grantable
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
JOIN pg_catalog.pg_type ty ON ty.oid=a.atttypid
JOIN pg_catalog.pg_namespace tn ON tn.oid=ty.typnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
LEFT JOIN LATERAL pg_catalog.aclexplode(a.attacl) x ON true
WHERE (n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events','public_band_profiles'))
 OR (n.nspname='supabase_migrations' AND c.relname='schema_migrations')
ORDER BY c.relname,a.attnum,x.grantee,x.privilege_type;

-- A6: function metadata and ACLs only; never invoke or print function bodies.
-- Fingerprints require comparison with a reviewed, same-version reference.
SELECT p.oid, p.proname, p.proargtypes::text AS argument_type_oids,
       p.prorettype AS return_type_oid, p.proowner AS owner_oid,
       p.prosecdef, p.provolatile, p.proparallel, p.prokind,
       p.prolang AS language_oid, p.prosupport AS planner_support_function_oid,
       COALESCE(p.proconfig @> ARRAY['search_path=""'],false) AS empty_search_path,
       pg_catalog.md5(p.prosrc) AS source_fingerprint,
       pg_catalog.md5(p.probin) AS binary_reference_fingerprint,
       pg_catalog.md5(p.prosqlbody::text) AS sql_body_tree_fingerprint,
       pg_catalog.md5(p.proargdefaults::text) AS defaults_tree_fingerprint,
       pg_catalog.md5(p.proconfig::text) AS configuration_fingerprint,
       a.grantee AS grantee_oid, a.privilege_type, a.is_grantable
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
LEFT JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a ON true
WHERE n.nspname='private'
 AND p.proname IN ('is_band_member','is_band_admin','is_band_member_for_user',
 'add_band_creator_as_admin','prevent_last_band_admin_removal',
 'prevent_task_author_or_band_change','set_updated_at','guard_event_ownership',
 'guard_band_member_band','guard_band_publication','guard_social_link_publication',
 'is_safe_external_url_v1','guard_external_link_url_v1','guard_functional_integrity_v1')
ORDER BY p.proname,p.oid,a.grantee;

-- A7: every trigger on the source tables/view, including unexpected ones.
SELECT c.relname, t.tgname, t.tgfoid AS function_oid, t.tgtype, t.tgenabled,
       t.tgisinternal, t.tgnargs, pg_catalog.md5(t.tgqual::text) AS condition_tree_fingerprint,
       pg_catalog.md5(pg_catalog.encode(t.tgargs,'hex')) AS arguments_fingerprint
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events','public_band_profiles')
ORDER BY 1,2;

-- Migration 10 rejects these trigger names globally, not just in public.
SELECT pg_catalog.count(*) AS global_functional_trigger_name_collisions
FROM pg_catalog.pg_trigger WHERE tgname LIKE '%_zz_guard_functional_integrity';

SELECT pg_catalog.count(*) FILTER (WHERE c.relname='bandup_url_contract_before') AS m9_snapshot_collisions,
       pg_catalog.count(*) FILTER (WHERE c.relname='bandup_url_expected_view') AS m9_view_collisions,
       pg_catalog.count(*) FILTER (WHERE c.relname='bandup_functional_before') AS m10_snapshot_collisions
FROM pg_catalog.pg_class c WHERE c.relnamespace=pg_catalog.pg_my_temp_schema();

SELECT c.relname, pg_catalog.count(t.oid) FILTER (WHERE NOT t.tgisinternal) AS user_trigger_count
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid
WHERE n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events') GROUP BY c.relname ORDER BY 1;

-- A8: constraints/indexes without expression literals.
SELECT c.relname, k.conname, k.contype, k.convalidated, k.condeferrable,
       k.condeferred, k.confrelid AS referenced_relation_oid, k.conkey, k.confkey,
       k.confdeltype, pg_catalog.md5(k.conbin::text) AS expression_tree_fingerprint
FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events') ORDER BY 1,2;

SELECT c.relname, i.indexrelid, i.indisunique, i.indisprimary, i.indisvalid,
       am.amname AS index_access_method, i.indclass::text AS operator_class_oids,
       i.indcollation::text AS collation_oids,
       i.indisready, pg_catalog.md5(i.indexprs::text) AS expressions_tree_fingerprint,
       pg_catalog.md5(i.indpred::text) AS predicate_tree_fingerprint
FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
JOIN pg_catalog.pg_am am ON am.oid=ic.relam
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events') ORDER BY 1,2;

-- A9: RLS policy expressions are fingerprinted, not displayed.
SELECT c.relname, p.polname, p.polcmd, p.polpermissive, p.polroles AS role_oids,
       pg_catalog.md5(p.polqual::text) AS using_tree_fingerprint,
       pg_catalog.md5(p.polwithcheck::text) AS check_tree_fingerprint
FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events') ORDER BY 1,2;

-- Direct view dependencies only. Do not query the view itself: drift could add
-- a side-effecting function. This inventory is not a transitive dependency audit.
SELECT DISTINCT d.refclassid AS catalog_oid, d.refobjid AS object_oid,
       d.refobjsubid AS column_number, d.deptype
FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_rewrite w ON w.oid=d.objid
JOIN pg_catalog.pg_class c ON c.oid=w.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE d.classid='pg_catalog.pg_rewrite'::regclass
 AND n.nspname='public' AND c.relname='public_band_profiles'
ORDER BY 1,2,3,4;

-- A10: fixed application roles only, never pg_authid or passwords.
-- Functions directly reached by policies, view rules or source triggers.
-- Unknown dependencies require review before C; fingerprints do not prove purity.
WITH sources AS (
 SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events','public_band_profiles')
), functions AS (
 SELECT t.tgfoid AS oid FROM pg_catalog.pg_trigger t
 WHERE t.tgrelid IN (SELECT oid FROM sources)
 UNION
 SELECT d.refobjid FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_policy p ON p.oid=d.objid
 WHERE d.classid='pg_catalog.pg_policy'::regclass
  AND d.refclassid='pg_catalog.pg_proc'::regclass AND p.polrelid IN (SELECT oid FROM sources)
 UNION
 SELECT d.refobjid FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_rewrite w ON w.oid=d.objid
 WHERE d.classid='pg_catalog.pg_rewrite'::regclass
  AND d.refclassid='pg_catalog.pg_proc'::regclass AND w.ev_class IN (SELECT oid FROM sources)
)
SELECT n.nspname,p.proname,p.oid,p.proowner AS owner_oid,p.prosecdef,p.provolatile,
       pg_catalog.md5(p.prosrc) AS source_fingerprint,
       pg_catalog.md5(p.probin) AS binary_reference_fingerprint,
       pg_catalog.md5(p.prosqlbody::text) AS sql_body_tree_fingerprint,
       pg_catalog.md5(p.proargdefaults::text) AS defaults_tree_fingerprint,
       pg_catalog.md5(p.proconfig::text) AS configuration_fingerprint
FROM functions f JOIN pg_catalog.pg_proc p ON p.oid=f.oid
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace ORDER BY 1,2,3;

SELECT r.rolname, r.oid, r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolbypassrls,
       r.rolcreatedb, r.rolcreaterole, r.rolreplication
FROM pg_catalog.pg_roles r WHERE r.rolname IN
 ('anon','authenticated','service_role','bandup_public_reader') ORDER BY 1;

SELECT m.roleid AS granted_role_oid, m.member AS member_role_oid, m.admin_option
FROM pg_catalog.pg_auth_members m
WHERE m.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN
 ('anon','authenticated','service_role','bandup_public_reader'))
 OR m.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN
 ('anon','authenticated','service_role','bandup_public_reader')) ORDER BY 1,2;

-- Effective inherited table/column/function privileges, beyond explicit ACLs.
SELECT r.rolname, c.relname,
       pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT') AS table_select,
       pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT') AS any_column_select,
       pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT') AS table_insert,
       pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE') AS table_update,
       pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE') AS table_delete,
       pg_catalog.pg_has_role(r.oid,c.relowner,'USAGE') AS effective_owner_membership
FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE r.rolname IN ('anon','authenticated','service_role','bandup_public_reader')
 AND n.nspname='public' AND c.relname IN
 ('bands','band_members','social_links','tasks','events','public_band_profiles')
ORDER BY 1,2;

SELECT r.rolname, n.nspname, pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE') AS usage,
       pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE') AS can_create
FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_namespace n
WHERE r.rolname IN ('anon','authenticated','service_role','bandup_public_reader')
 AND n.nspname IN ('public','private') ORDER BY 1,2;

SELECT r.rolname, p.proname, p.oid AS function_oid,
       pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute
FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE r.rolname IN ('anon','authenticated','service_role','bandup_public_reader')
 AND n.nspname='private' AND p.proname IN
 ('is_band_member','is_band_admin','is_safe_external_url_v1',
 'guard_external_link_url_v1','guard_functional_integrity_v1') ORDER BY 1,2,3;

SELECT d.defaclrole AS owner_oid, d.defaclnamespace AS schema_oid, d.defaclobjtype,
       a.grantee AS grantee_oid, a.privilege_type, a.is_grantable
FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
WHERE d.defaclnamespace=0 OR d.defaclnamespace IN
 (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname IN ('public','private')) ORDER BY 1,2,3,4;

ROLLBACK;
