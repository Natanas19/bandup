-- PREPARED, NOT EXECUTED. Disposable local Supabase-compatible database ONLY.
-- Plain psql regression suite, not pgTAP. Start as a capable administrative harness after all migrations.
-- This script does not create a database or apply any migration.
\set ON_ERROR_STOP on
BEGIN;
\ir sql_test_capabilities.sql

DO $prerequisites$
BEGIN
  IF pg_catalog.to_regclass('public.public_band_profiles') IS NULL
     OR pg_catalog.to_regprocedure('private.guard_band_publication()') IS NULL
     OR pg_catalog.to_regprocedure('private.guard_social_link_publication()') IS NULL
     OR pg_catalog.to_regprocedure('private.guard_event_ownership()') IS NULL
     OR pg_catalog.to_regprocedure('private.guard_band_member_band()') IS NULL THEN
    RAISE EXCEPTION 'Required public profile objects are missing in the approved disposable database';
  END IF;
END;
$prerequisites$;

CREATE FUNCTION pg_temp.public_profile_assert(ok BOOLEAN, label TEXT)
RETURNS VOID LANGUAGE PLPGSQL SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Public profile assertion failed: %', label;
  END IF;
END;
$function$;

CREATE FUNCTION pg_temp.public_profile_expect_error(
  command TEXT, expected_state TEXT, expected_constraint TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE PLPGSQL SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  actual_state TEXT;
  actual_constraint TEXT;
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE,
      actual_constraint = CONSTRAINT_NAME;
    IF actual_state = expected_state AND (
      expected_constraint IS NULL OR actual_constraint = expected_constraint
    ) THEN
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected rejection did not occur';
END;
$function$;

-- RLS-hidden UPDATE/DELETE can succeed with zero rows; require exactly zero.
CREATE FUNCTION pg_temp.public_profile_expect_zero(command TEXT)
RETURNS VOID LANGUAGE PLPGSQL SECURITY INVOKER SET search_path = '' AS $function$
DECLARE affected BIGINT;
BEGIN
  EXECUTE command;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Unauthorized statement changed records';
  END IF;
END;
$function$;

CREATE FUNCTION pg_temp.public_profile_actor(
  user_id TEXT, actor_role TEXT DEFAULT 'authenticated'
)
RETURNS VOID LANGUAGE PLPGSQL SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(user_id, ''), true);
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', user_id, 'role', actor_role)::text, true);
END;
$function$;

-- Catalog checks run as the administrative harness, before switching to application roles.
SELECT pg_temp.public_profile_assert((
  SELECT pg_catalog.array_agg(column_name::text ORDER BY ordinal_position)
    = ARRAY['name', 'slug', 'description', 'logo_url', 'links']::text[]
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'public_band_profiles'
), 'exact public projection columns');

SELECT pg_temp.public_profile_assert((
  SELECT count(*) = 2 AND bool_and(is_nullable = 'NO' AND column_default = 'false')
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('bands', 'social_links') AND column_name = 'is_public'
), 'both publication columns are NOT NULL DEFAULT false');

SELECT pg_temp.public_profile_assert((
  SELECT NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
  FROM pg_catalog.pg_roles WHERE rolname = 'bandup_public_reader'
), 'reader is an unprivileged non-login role');

SELECT pg_temp.public_profile_assert((
  SELECT relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'bandup_public_reader')
    AND reloptions @> ARRAY['security_barrier=true', 'security_invoker=false']
  FROM pg_catalog.pg_class WHERE oid = 'public.public_band_profiles'::regclass
), 'view has the restricted owner and explicit security options');

SELECT pg_temp.public_profile_assert(
  NOT pg_catalog.has_schema_privilege('bandup_public_reader', 'public', 'CREATE')
  AND NOT pg_catalog.has_column_privilege('bandup_public_reader', 'public.bands', 'created_at', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('bandup_public_reader', 'public.events', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('bandup_public_reader', 'public.tasks', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('bandup_public_reader', 'public.band_members', 'SELECT'),
  'reader cannot create objects or read unrelated/internal data'
);

DO $privileges$
DECLARE role_name TEXT; relation_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    PERFORM pg_temp.public_profile_assert(
      NOT pg_catalog.pg_has_role(role_name, 'bandup_public_reader', 'MEMBER'),
      'application roles cannot assume the reader role'
    );
    PERFORM pg_temp.public_profile_assert(
      NOT pg_catalog.has_function_privilege(role_name, 'private.guard_band_publication()', 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege(role_name, 'private.guard_social_link_publication()', 'EXECUTE'),
      'new trigger functions have no direct application EXECUTE grant'
    );
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY[
    'public.bands', 'public.social_links', 'public.band_members', 'public.tasks', 'public.events'
  ] LOOP
    PERFORM pg_temp.public_profile_assert(
      NOT pg_catalog.has_any_column_privilege('anon', relation_name, 'SELECT')
      AND NOT pg_catalog.has_table_privilege('anon', relation_name, 'INSERT')
      AND NOT pg_catalog.has_table_privilege('anon', relation_name, 'UPDATE')
      AND NOT pg_catalog.has_table_privilege('anon', relation_name, 'DELETE'),
      'anon has no source-table access'
    );
  END LOOP;
END;
$privileges$;
-- Check effective table/column privileges, including inherited and PUBLIC grants.
DO $public_profile_acl_matrix$
DECLARE
  role_name TEXT;
  relation_name TEXT;
  privilege_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.public_profile_assert(
      pg_catalog.has_table_privilege(role_name, 'public.public_band_profiles', 'SELECT'),
      role_name || ' has SELECT on the public view'
    );
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF privilege_name <> 'SELECT' THEN
        PERFORM pg_temp.public_profile_assert(
          NOT pg_catalog.has_table_privilege(role_name, 'public.public_band_profiles', privilege_name),
          role_name || ' has no ' || privilege_name || ' on the public view'
        );
      END IF;
      PERFORM pg_temp.public_profile_assert(
        NOT pg_catalog.has_table_privilege(
          role_name, 'public.public_band_profiles', privilege_name || ' WITH GRANT OPTION'
        ),
        role_name || ' has no ' || privilege_name || ' WITH GRANT OPTION on the public view'
      );
    END LOOP;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF privilege_name <> 'SELECT' THEN
        PERFORM pg_temp.public_profile_assert(
          NOT pg_catalog.has_any_column_privilege(role_name, 'public.public_band_profiles', privilege_name),
          role_name || ' has no column ' || privilege_name || ' on the public view'
        );
      END IF;
      PERFORM pg_temp.public_profile_assert(
        NOT pg_catalog.has_any_column_privilege(
          role_name, 'public.public_band_profiles', privilege_name || ' WITH GRANT OPTION'
        ),
        role_name || ' has no column ' || privilege_name || ' WITH GRANT OPTION on the public view'
      );
    END LOOP;
  END LOOP;

  FOREACH relation_name IN ARRAY ARRAY[
    'public.bands', 'public.social_links', 'public.band_members', 'public.tasks', 'public.events'
  ] LOOP
    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      PERFORM pg_temp.public_profile_assert(
        NOT pg_catalog.has_table_privilege('anon', relation_name, privilege_name),
        'anon has no ' || privilege_name || ' on ' || relation_name
      );
      PERFORM pg_temp.public_profile_assert(
        NOT pg_catalog.has_table_privilege('anon', relation_name, privilege_name || ' WITH GRANT OPTION'),
        'anon has no ' || privilege_name || ' WITH GRANT OPTION on ' || relation_name
      );
    END LOOP;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      PERFORM pg_temp.public_profile_assert(
        NOT pg_catalog.has_any_column_privilege('anon', relation_name, privilege_name),
        'anon has no column ' || privilege_name || ' on ' || relation_name
      );
      PERFORM pg_temp.public_profile_assert(
        NOT pg_catalog.has_any_column_privilege('anon', relation_name, privilege_name || ' WITH GRANT OPTION'),
        'anon has no column ' || privilege_name || ' WITH GRANT OPTION on ' || relation_name
      );
    END LOOP;
  END LOOP;
END;
$public_profile_acl_matrix$;

-- Fictitious users: 1 admin A/C, 2 admin B, 3 ordinary member A,
-- 4 outsider, 5 admin A/B (so transfer guards are tested beyond RLS).
-- Fixed IDs/slugs deliberately fail on collisions; never reuse existing rows.
INSERT INTO auth.users (id) VALUES
  ('71000000-0000-0000-0000-000000000001'),
  ('71000000-0000-0000-0000-000000000002'),
  ('71000000-0000-0000-0000-000000000003'),
  ('71000000-0000-0000-0000-000000000004'),
  ('71000000-0000-0000-0000-000000000005');

SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000001');
INSERT INTO public.bands (id, name, slug, description, logo_url) VALUES
  ('72000000-0000-0000-0000-000000000001', 'Public fixture A', 'public-profile-test-a', 'Public description A', 'https://example.invalid/public-logo.svg'),
  ('72000000-0000-0000-0000-000000000003', 'Public fixture C', 'public-profile-test-c', NULL, NULL);
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000002');
INSERT INTO public.bands (id, name, slug, description) VALUES
  ('72000000-0000-0000-0000-000000000002', 'PRIVATE BAND B', 'public-profile-test-b', 'PRIVATE DESCRIPTION B');

INSERT INTO public.band_members (band_id, user_id, role) VALUES
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003', 'member'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000005', 'admin'),
  ('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000005', 'admin');

INSERT INTO public.social_links (id, band_id, platform, url) VALUES
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'spotify', 'https://example.invalid/public-a'),
  ('73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', 'internal', 'https://example.invalid/PRIVATE-LINK-A'),
  ('73000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000002', 'website', 'https://example.invalid/PRIVATE-BAND-LINK');

INSERT INTO public.events (id, band_id, created_by, title, description, event_type, start_at, location) VALUES
  ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003',
   'PRIVATE EVENT', 'PRIVATE EVENT DESCRIPTION', 'rehearsal', now() + interval '1 day', 'PRIVATE LOCATION');
INSERT INTO public.tasks (id, band_id, created_by, assigned_to, event_id, title, status, priority) VALUES
  ('75000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003',
   '71000000-0000-0000-0000-000000000003', '74000000-0000-0000-0000-000000000001', 'PRIVATE TASK', 'todo', 'medium');

SELECT pg_temp.public_profile_assert(
  NOT EXISTS (SELECT 1 FROM public.bands WHERE slug LIKE 'public-profile-test-%' AND is_public)
  AND NOT EXISTS (SELECT 1 FROM public.social_links WHERE id IN (
    '73000000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000002',
    '73000000-0000-0000-0000-000000000003'
  ) AND is_public), 'new fixtures start private'
);

SET LOCAL ROLE anon;
SELECT pg_temp.public_profile_actor(NULL, 'anon');
SELECT pg_temp.public_profile_assert(
  NOT EXISTS (SELECT 1 FROM public.public_band_profiles WHERE slug LIKE 'public-profile-test-%'),
  'no fixture is public before explicit opt-in'
);
DO $anonymous_access$
DECLARE relation_name TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'public.bands', 'public.social_links', 'public.band_members', 'public.tasks', 'public.events'
  ] LOOP
    PERFORM pg_temp.public_profile_expect_error(
      'SELECT * FROM ' || relation_name, '42501'
    );
  END LOOP;
END;
$anonymous_access$;
SELECT pg_temp.public_profile_expect_error(
  'UPDATE public.public_band_profiles SET name = ''Forbidden'' WHERE slug = ''public-profile-test-a''',
  '42501'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000001');
SELECT pg_temp.public_profile_expect_error($q$
  INSERT INTO public.bands (id, name, slug, is_public)
  VALUES ('72000000-0000-0000-0000-000000000099', 'Forbidden', 'public-profile-forbidden', true)
$q$, '23514', 'bands_start_unpublished');
SELECT pg_temp.public_profile_expect_error($q$
  INSERT INTO public.bands (id, name, slug, is_public)
  VALUES ('72000000-0000-0000-0000-000000000099', 'Forbidden', 'public-profile-forbidden', NULL)
$q$, '23502');

UPDATE public.bands SET is_public = true
WHERE id IN ('72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000003');
UPDATE public.social_links SET is_public = true
WHERE id = '73000000-0000-0000-0000-000000000001';
SELECT pg_temp.public_profile_assert(
  (SELECT is_public FROM public.bands WHERE id = '72000000-0000-0000-0000-000000000001')
  AND (SELECT is_public FROM public.social_links WHERE id = '73000000-0000-0000-0000-000000000001'),
  'admin explicitly publishes own band and link'
);

-- B's admin can select a link while B remains unpublished.
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000002');
UPDATE public.social_links SET is_public = true
WHERE id = '73000000-0000-0000-0000-000000000003';

RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.public_profile_actor(NULL, 'anon');
SELECT pg_temp.public_profile_assert(
  (SELECT count(*) = 2 FROM public.public_band_profiles WHERE slug LIKE 'public-profile-test-%')
  AND NOT EXISTS (SELECT 1 FROM public.public_band_profiles WHERE slug = 'public-profile-test-b')
  AND NOT EXISTS (SELECT 1 FROM public.public_band_profiles WHERE slug = 'public-profile-does-not-exist'),
  'only A and C are visible; private and missing slugs both return no row'
);
SELECT pg_temp.public_profile_assert(
  (SELECT links = '[{"platform":"spotify","url":"https://example.invalid/public-a"}]'::jsonb
   FROM public.public_band_profiles WHERE slug = 'public-profile-test-a')
  AND (SELECT links = '[]'::jsonb AND description IS NULL AND logo_url IS NULL
       FROM public.public_band_profiles WHERE slug = 'public-profile-test-c'),
  'only the selected link appears; empty profiles have an empty link array'
);
SELECT pg_temp.public_profile_assert(
  NOT EXISTS (
    SELECT 1 FROM public.public_band_profiles AS profile
    WHERE profile.slug LIKE 'public-profile-test-%'
      AND (
        pg_catalog.to_jsonb(profile)::text LIKE '%PRIVATE%'
        OR pg_catalog.to_jsonb(profile)::text LIKE '%71000000-%'
        OR pg_catalog.to_jsonb(profile)::text LIKE '%72000000-%'
        OR pg_catalog.to_jsonb(profile)::text LIKE '%73000000-%'
        OR pg_catalog.to_jsonb(profile)::text LIKE '%74000000-%'
        OR pg_catalog.to_jsonb(profile)::text LIKE '%75000000-%'
      )
  ), 'no private links, records or internal identifiers in the payload'
);
SELECT pg_temp.public_profile_assert(
  NOT EXISTS (
    SELECT 1 FROM public.public_band_profiles AS profile,
      LATERAL pg_catalog.jsonb_array_elements(profile.links) AS item(value)
    WHERE profile.slug LIKE 'public-profile-test-%'
      AND (SELECT pg_catalog.array_agg(key ORDER BY key)
           FROM pg_catalog.jsonb_object_keys(item.value) AS keys(key))
          <> ARRAY['platform', 'url']::text[]
  ), 'link payload contains only platform and url'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
-- A member can read public profiles but cannot change publication.
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000003');
SELECT pg_temp.public_profile_expect_zero($q$
  UPDATE public.bands SET is_public = false WHERE id = '72000000-0000-0000-0000-000000000001'
$q$);
SELECT pg_temp.public_profile_expect_zero($q$
  UPDATE public.social_links SET is_public = true WHERE id = '73000000-0000-0000-0000-000000000002'
$q$);
SELECT pg_temp.public_profile_expect_error($q$
  INSERT INTO public.social_links (band_id, platform, url, is_public)
  VALUES ('72000000-0000-0000-0000-000000000001', 'website', 'https://example.invalid/forbidden', true)
$q$, '23514', 'social_links_publication_admin_only');
SELECT pg_temp.public_profile_expect_error($q$
  INSERT INTO public.social_links (band_id, platform, url)
  VALUES ('72000000-0000-0000-0000-000000000001', 'website', 'https://example.invalid/forbidden')
$q$, '42501');
SELECT pg_temp.public_profile_assert(
  (SELECT is_public FROM public.bands WHERE id = '72000000-0000-0000-0000-000000000001')
  AND NOT (SELECT is_public FROM public.social_links WHERE id = '73000000-0000-0000-0000-000000000002'),
  'member attempts do not change publication'
);

-- Exercise the triggers independently of RLS, using the privileged test harness.
-- These are not application access paths: the administrative harness remains trusted infrastructure.
RESET ROLE;
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000003');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.bands SET is_public = false
  WHERE id = '72000000-0000-0000-0000-000000000001'
$q$, '23514', 'bands_publication_admin_only');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.social_links SET is_public = true
  WHERE id = '73000000-0000-0000-0000-000000000002'
$q$, '23514', 'social_links_publication_admin_only');
SELECT pg_temp.public_profile_actor(NULL, 'anon');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.bands SET is_public = false
  WHERE id = '72000000-0000-0000-0000-000000000001'
$q$, '23514', 'bands_publication_admin_only');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.social_links SET is_public = true
  WHERE id = '73000000-0000-0000-0000-000000000002'
$q$, '23514', 'social_links_publication_admin_only');
SET LOCAL ROLE authenticated;

-- A's admin cannot publish B, including a mixed batch targeting A and B.
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000001');
UPDATE public.bands SET is_public = true
WHERE id IN ('72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002');
SELECT pg_temp.public_profile_expect_zero($q$
  UPDATE public.social_links SET is_public = false WHERE id = '73000000-0000-0000-0000-000000000003'
$q$);
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000004');
SELECT pg_temp.public_profile_expect_zero($q$
  UPDATE public.bands SET is_public = true WHERE id = '72000000-0000-0000-0000-000000000002'
$q$);
SELECT pg_temp.public_profile_expect_zero($q$
  UPDATE public.social_links SET is_public = true WHERE id = '73000000-0000-0000-0000-000000000002'
$q$);
SELECT pg_temp.public_profile_assert(
  NOT EXISTS (SELECT 1 FROM public.bands WHERE slug LIKE 'public-profile-test-%')
  AND EXISTS (SELECT 1 FROM public.public_band_profiles WHERE slug = 'public-profile-test-a'),
  'signed-in outsider gets only the public projection'
);

-- An admin of BOTH bands still cannot move links, even when publication changes too.
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000005');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.social_links SET band_id = '72000000-0000-0000-0000-000000000002'
  WHERE id = '73000000-0000-0000-0000-000000000001'
$q$, '23514', 'social_links_band_immutable');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.social_links SET is_public = NOT is_public,
    band_id = CASE WHEN id = '73000000-0000-0000-0000-000000000001'
      THEN '72000000-0000-0000-0000-000000000002'::uuid ELSE band_id END
  WHERE band_id = '72000000-0000-0000-0000-000000000001'
$q$, '23514', 'social_links_band_immutable');
SELECT pg_temp.public_profile_expect_error($q$
  INSERT INTO public.social_links (id, band_id, platform, url)
  VALUES ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002', 'spotify', 'https://example.invalid/forbidden-transfer')
  ON CONFLICT (id) DO UPDATE SET band_id = EXCLUDED.band_id
$q$, '23514', 'social_links_band_immutable');
SELECT pg_temp.public_profile_assert(
  (SELECT is_public AND band_id = '72000000-0000-0000-0000-000000000001'::uuid
   FROM public.social_links WHERE id = '73000000-0000-0000-0000-000000000001')
  AND NOT (SELECT is_public FROM public.social_links WHERE id = '73000000-0000-0000-0000-000000000002')
  AND NOT (SELECT is_public FROM public.bands WHERE id = '72000000-0000-0000-0000-000000000002'),
  'failed transfers and mixed updates retain original state; B stays private'
);

-- Legitimate admin upsert: the INSERT candidate starts private.
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000001');
INSERT INTO public.social_links (id, band_id, platform, url, is_public)
VALUES ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'spotify', 'https://example.invalid/public-a', true)
ON CONFLICT (id) DO UPDATE SET is_public = EXCLUDED.is_public;
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.social_links SET is_public = NULL
  WHERE id = '73000000-0000-0000-0000-000000000001'
$q$, '23502');
UPDATE public.bands SET is_public = false WHERE id = '72000000-0000-0000-0000-000000000001';

RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.public_profile_actor(NULL, 'anon');
SELECT pg_temp.public_profile_assert(
  NOT EXISTS (SELECT 1 FROM public.public_band_profiles WHERE slug = 'public-profile-test-a'),
  'unpublishing immediately removes the profile from a new statement'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000001');
SELECT pg_temp.public_profile_assert(
  (SELECT is_public FROM public.social_links WHERE id = '73000000-0000-0000-0000-000000000001'),
  'unpublishing a band preserves the explicit link selection'
);
INSERT INTO public.bands (id, name, slug, is_public)
VALUES ('72000000-0000-0000-0000-000000000001', 'Public fixture A', 'public-profile-test-a', false)
ON CONFLICT (id) DO UPDATE SET is_public = true;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.public_profile_actor(NULL, 'anon');
SELECT pg_temp.public_profile_assert(
  (SELECT links = '[{"platform":"spotify","url":"https://example.invalid/public-a"}]'::jsonb
   FROM public.public_band_profiles WHERE slug = 'public-profile-test-a'),
  'explicit republication restores only selected links'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000001');
UPDATE public.social_links SET is_public = false
WHERE id = '73000000-0000-0000-0000-000000000001';
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.public_profile_actor(NULL, 'anon');
SELECT pg_temp.public_profile_assert(
  (SELECT links = '[]'::jsonb FROM public.public_band_profiles WHERE slug = 'public-profile-test-a'),
  'unpublishing a link keeps the band visible and removes the link'
);

-- Existing non-public authorization and ownership guards still apply.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000003');
UPDATE public.events SET title = 'PRIVATE EVENT EDITED'
WHERE id = '74000000-0000-0000-0000-000000000001';
UPDATE public.tasks SET status = 'in_progress'
WHERE id = '75000000-0000-0000-0000-000000000001';
SELECT pg_temp.public_profile_assert(
  (SELECT title = 'PRIVATE EVENT EDITED' FROM public.events WHERE id = '74000000-0000-0000-0000-000000000001')
  AND (SELECT status = 'in_progress' FROM public.tasks WHERE id = '75000000-0000-0000-0000-000000000001'),
  'legitimate member edits remain available'
);
SELECT pg_temp.public_profile_expect_zero($q$
  DELETE FROM public.events WHERE id = '74000000-0000-0000-0000-000000000001'
$q$);
SELECT pg_temp.public_profile_expect_zero($q$
  DELETE FROM public.tasks WHERE id = '75000000-0000-0000-0000-000000000001'
$q$);

SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000005');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.events SET band_id = '72000000-0000-0000-0000-000000000002'
  WHERE id = '74000000-0000-0000-0000-000000000001'
$q$, '23514', 'events_ownership_immutable');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.band_members SET band_id = '72000000-0000-0000-0000-000000000002'
  WHERE band_id = '72000000-0000-0000-0000-000000000001'
    AND user_id = '71000000-0000-0000-0000-000000000003'
$q$, '23514', 'band_members_band_immutable');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.band_members SET user_id = '71000000-0000-0000-0000-000000000004'
  WHERE band_id = '72000000-0000-0000-0000-000000000001'
    AND user_id = '71000000-0000-0000-0000-000000000003'
$q$, 'P0001');

SELECT pg_temp.public_profile_actor('71000000-0000-0000-0000-000000000001');
SELECT pg_temp.public_profile_expect_error($q$
  UPDATE public.band_members SET role = 'member'
  WHERE band_id = '72000000-0000-0000-0000-000000000003'
    AND user_id = '71000000-0000-0000-0000-000000000001'
$q$, 'P0001');
DELETE FROM public.events WHERE id = '74000000-0000-0000-0000-000000000001';
SELECT pg_temp.public_profile_assert(
  (SELECT event_id IS NULL FROM public.tasks WHERE id = '75000000-0000-0000-0000-000000000001'),
  'authorized event deletion still clears task event_id'
);
DELETE FROM public.band_members
WHERE band_id = '72000000-0000-0000-0000-000000000001'
  AND user_id = '71000000-0000-0000-0000-000000000003';
SELECT pg_temp.public_profile_assert(
  (SELECT assigned_to IS NULL FROM public.tasks WHERE id = '75000000-0000-0000-0000-000000000001'),
  'authorized membership deletion still clears task assignment'
);
DELETE FROM public.tasks WHERE id = '75000000-0000-0000-0000-000000000001';
DELETE FROM public.bands WHERE id = '72000000-0000-0000-0000-000000000003';
SELECT pg_temp.public_profile_assert(
  NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = '75000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.public_band_profiles WHERE slug = 'public-profile-test-c'),
  'admin deletions and band cascades remain functional'
);

-- All fixture writes, helpers and claims are discarded. No migration is run here.
RESET ROLE;
ROLLBACK;
