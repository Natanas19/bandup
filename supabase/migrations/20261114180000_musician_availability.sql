-- LOCAL REVIEW CANDIDATE ONLY. Not applied to Demo.
-- Remote migration history remains unreconciled: never run db push or repair.
-- Absence of an availability row means false. No signup trigger/backfill needed.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE api_role text;
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'Requires reviewed postgres executor with existing RLS bypass'; END IF;
  IF pg_catalog.to_regclass('public.musician_availability') IS NOT NULL
    OR pg_catalog.to_regtype('public.musician_availability') IS NOT NULL THEN
    RAISE EXCEPTION 'Availability object already exists; inspect destination';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Missing Auth identity helper';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure('auth.uid()')
      AND p.prokind = 'f' AND NOT p.proretset
      AND p.prorettype = 'pg_catalog.uuid'::regtype
  ) THEN RAISE EXCEPTION 'Expected scalar UUID Auth identity helper'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_constraint k ON k.conrelid = a.attrelid
    JOIN pg_catalog.pg_index i ON i.indexrelid = k.conindid
    WHERE a.attrelid = pg_catalog.to_regclass('auth.users')
      AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = 'pg_catalog.uuid'::regtype AND a.attnotnull
      AND k.contype = 'p' AND k.conkey = ARRAY[a.attnum]
      AND NOT k.condeferrable AND i.indisvalid AND i.indisunique
  ) THEN RAISE EXCEPTION 'Expected existing UUID primary key auth.users.id'; END IF;
  IF NOT pg_catalog.has_column_privilege(current_user, 'auth.users', 'id', 'REFERENCES') THEN
    RAISE EXCEPTION 'Executor lacks REFERENCES on auth.users.id; no source grants repaired';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
    OR NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE')
    OR NOT pg_catalog.has_schema_privilege('authenticated', 'auth', 'USAGE')
    OR NOT pg_catalog.has_function_privilege('authenticated', 'auth.uid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Required existing schema/helper privileges unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unexpected application RLS bypass';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(api_role, 'public', 'CREATE')
      OR pg_catalog.pg_has_role(api_role, 'postgres', 'MEMBER') THEN
      RAISE EXCEPTION 'Unexpected application schema/owner privileges';
    END IF;
  END LOOP;
END $preflight$;

CREATE TABLE public.musician_availability (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  available boolean NOT NULL DEFAULT false
);
ALTER TABLE public.musician_availability OWNER TO postgres;
ALTER TABLE public.musician_availability ENABLE ROW LEVEL SECURITY;

-- Remove default table grants only from this new object, before narrow grants.
REVOKE ALL ON TABLE public.musician_availability
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (user_id, available), INSERT (user_id, available)
  ON TABLE public.musician_availability TO authenticated;
GRANT UPDATE (available)
  ON TABLE public.musician_availability TO authenticated;

CREATE POLICY musician_availability_select_own
  ON public.musician_availability FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY musician_availability_insert_own
  ON public.musician_availability FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY musician_availability_update_own
  ON public.musician_availability FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- INSERT an own row or UPDATE available only; do not upsert user_id as an UPDATE.
-- No DELETE, public directory, Auth read grant, RPC or membership change.
DO $postflight$
DECLARE
  api_role text;
  relation oid := 'public.musician_availability'::regclass;
  -- PostgreSQL 17 deparses the scalar subquery with its inferred output alias.
  -- Normalize whitespace only; do not discard operators, casts or predicates.
  owner_predicate CONSTANT text := '(user_id=(SELECTauth.uid()ASuid))';
BEGIN
  -- Reject unexpected default grants, including grants to custom roles.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.oid = relation
      AND (a.grantee <> 'postgres'::regrole OR a.grantor <> 'postgres'::regrole)
  ) THEN RAISE EXCEPTION 'Unexpected availability table ACL'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute col
    CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE col.attrelid = relation AND col.attnum > 0 AND NOT col.attisdropped
      AND (a.grantee <> 'authenticated'::regrole OR a.grantor <> 'postgres'::regrole
        OR a.is_grantable
        OR NOT (a.privilege_type IN ('SELECT', 'INSERT')
          OR (a.privilege_type = 'UPDATE' AND col.attname = 'available')))
  ) THEN RAISE EXCEPTION 'Unexpected availability column ACL'; END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(api_role, relation,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'Unexpected effective table privilege; no existing grants repaired';
    END IF;
    IF api_role <> 'authenticated' AND pg_catalog.has_any_column_privilege(
      api_role, relation, 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Unexpected effective column access';
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_column_privilege('authenticated', relation, 'user_id', 'SELECT')
    OR NOT pg_catalog.has_column_privilege('authenticated', relation, 'available', 'SELECT')
    OR NOT pg_catalog.has_column_privilege('authenticated', relation, 'user_id', 'INSERT')
    OR NOT pg_catalog.has_column_privilege('authenticated', relation, 'available', 'INSERT')
    OR NOT pg_catalog.has_column_privilege('authenticated', relation, 'available', 'UPDATE')
    OR pg_catalog.has_column_privilege('authenticated', relation, 'user_id', 'UPDATE')
    OR pg_catalog.has_any_column_privilege('authenticated', relation, 'REFERENCES') THEN
    RAISE EXCEPTION 'Unexpected effective titular column privileges';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = relation) <> 3
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = relation AND relrowsecurity AND relowner = 'postgres'::regrole) THEN
    RAISE EXCEPTION 'Unexpected availability RLS/owner';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('musician_availability_select_own', 'r', true, false),
      ('musician_availability_insert_own', 'a', false, true),
      ('musician_availability_update_own', 'w', true, true)
    ) AS expected(policy_name, command, needs_using, needs_check)
    LEFT JOIN pg_catalog.pg_policy p
      ON p.polrelid = relation AND p.polname = expected.policy_name
    WHERE p.oid IS NULL
      OR p.polcmd::text IS DISTINCT FROM expected.command
      OR p.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
      OR p.polpermissive IS DISTINCT FROM true
      OR pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(p.polqual, p.polrelid, false), '[[:space:]]', '', 'g'
      ) IS DISTINCT FROM CASE WHEN expected.needs_using THEN owner_predicate ELSE NULL::text END
      OR pg_catalog.regexp_replace(
        pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false), '[[:space:]]', '', 'g'
      ) IS DISTINCT FROM CASE WHEN expected.needs_check THEN owner_predicate ELSE NULL::text END
  ) THEN RAISE EXCEPTION 'Unexpected availability policy contract'; END IF;
END $postflight$;
COMMIT;
