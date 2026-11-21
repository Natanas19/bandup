-- REVIEWED QUERY CANDIDATE, NOT EXECUTED AGAINST POSTGRESQL.
-- Fixed target: bandup_audit_ro. Metadata only; no application routine is called.
-- Provisioning identity is NOT an audit credential. Keep the target NOLOGIN.
-- A future authorized metadata session must be selected explicitly; no fallback.
-- SQL produces one JSON result, including empty sections and role-existence flag.
-- Missing role/permission/error means NOT VERIFIED, never a clean bill of health.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog;

WITH target AS (
  SELECT oid, rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
         rolreplication, rolbypassrls
  FROM pg_roles WHERE rolname = 'bandup_audit_ro'
), routines AS (
  SELECT n.nspname AS schema_name, p.proname AS routine_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prokind AS kind, p.prosecdef AS security_definer,
    format_type(p.prorettype,NULL) AS return_type,
    has_function_privilege(t.oid,p.oid,'EXECUTE') AS effective_execute,
    has_schema_privilege(t.oid,n.oid,'USAGE') AS schema_usage,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=t.oid AND a.privilege_type='EXECUTE') AS direct_execute,
    EXISTS(SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search_path=%') AS explicit_search_path,
    md5(pg_get_functiondef(p.oid)) AS definition_fingerprint
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN target t
  WHERE p.prokind IN ('f','p','w')
    AND left(n.nspname,3)<>'pg_' AND n.nspname<>'information_schema'
), sequences AS (
  SELECT n.nspname AS schema_name,c.relname AS sequence_name,
    has_schema_privilege(t.oid,n.oid,'USAGE') AS schema_usage,
    has_sequence_privilege(t.oid,c.oid,'SELECT') AS effective_select,
    has_sequence_privilege(t.oid,c.oid,'USAGE') AS effective_usage,
    has_sequence_privilege(t.oid,c.oid,'UPDATE') AS effective_update,
    coalesce((SELECT jsonb_agg(jsonb_build_object('privilege',a.privilege_type,
      'grantable',a.is_grantable) ORDER BY a.privilege_type)
      FROM aclexplode(coalesce(c.relacl,acldefault('s',c.relowner))) a
      WHERE a.grantee=0),'[]'::jsonb) AS public_acl
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN target t
  WHERE c.relkind='S' AND left(n.nspname,3)<>'pg_'
), object_acls AS (
  SELECT 'database'::text AS kind,d.datname::text AS object_name,
    coalesce(d.datacl,acldefault('d',d.datdba)) AS acl FROM pg_database d
  UNION ALL
  SELECT 'schema',n.nspname,coalesce(n.nspacl,acldefault('n',n.nspowner))
    FROM pg_namespace n WHERE left(n.nspname,3)<>'pg_'
  UNION ALL
  SELECT CASE WHEN c.relkind='S' THEN 'sequence' ELSE 'relation' END,
    n.nspname||'.'||c.relname,
    coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','f','S') AND left(n.nspname,3)<>'pg_'
  UNION ALL
  SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attname,a.attacl
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
      AND left(n.nspname,3)<>'pg_'
), public_acls AS (
  SELECT o.kind,o.object_name,a.privilege_type,a.is_grantable
  FROM object_acls o CROSS JOIN LATERAL aclexplode(o.acl) a WHERE a.grantee=0
), defaults AS (
  SELECT d.defaclrole::regrole::text AS creating_role,
    CASE WHEN d.defaclnamespace=0 THEN '(global)' ELSE n.nspname END AS schema_scope,
    d.defaclobjtype AS object_type,a.privilege_type,a.is_grantable,
    a.grantee=0 AS granted_to_public,a.grantee=t.oid AS granted_directly_to_auditor,
    CASE WHEN a.grantee=0 THEN true ELSE pg_has_role(t.oid,a.grantee,'USAGE') END AS available_now,
    CASE WHEN a.grantee=0 THEN true ELSE pg_has_role(t.oid,a.grantee,'MEMBER') END AS membership_path
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a CROSS JOIN target t
), memberships AS (
  SELECT r.rolname AS granted_role,pg_has_role(t.oid,r.oid,'USAGE') AS available_now,
    pg_has_role(t.oid,r.oid,'SET') AS can_set_role
  FROM pg_roles r CROSS JOIN target t
  WHERE r.oid<>t.oid AND pg_has_role(t.oid,r.oid,'MEMBER')
)
SELECT jsonb_build_object(
  'formatVersion',2,'target','bandup_audit_ro',
  'serverVersionNum',current_setting('server_version_num')::integer,
  'collectedAt',statement_timestamp(),
  'scope','non-system-catalog-metadata',
  'transactionReadOnly',current_setting('transaction_read_only')='on',
  'targetExists',EXISTS(SELECT 1 FROM target),
  'role',(SELECT to_jsonb(t)-'oid' FROM target t),
  'routines',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY schema_name,routine_name,arguments) FROM routines r),'[]'::jsonb),
  'sequences',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY schema_name,sequence_name) FROM sequences s),'[]'::jsonb),
  'publicAcls',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY kind,object_name,privilege_type) FROM public_acls a),'[]'::jsonb),
  'defaultPrivileges',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY creating_role,schema_scope,object_type) FROM defaults d),'[]'::jsonb),
  'memberships',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY granted_role) FROM memberships m),'[]'::jsonb)
);
ROLLBACK;
