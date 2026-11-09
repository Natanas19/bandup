-- REVIEW CANDIDATE ONLY. DO NOT APPLY OR RUN DB PUSH WITHOUT SEPARATE APPROVAL.
-- Based on bandup_rpc_definicoes_instaladas.sql; that reference is never executed.
-- Replaces only the reviewed discovery query and request eligibility predicate.
-- Existing signatures, result types, owners, ACLs and security settings are kept.
-- No tables, rows, policies, indexes or administrative functions are changed.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $review$
DECLARE
  reference_discover CONSTANT text := $reference_discover$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Limit must be between 1 and 50';
  END IF;
  RETURN QUERY SELECT d.band_id,d.display_name,d.summary FROM public.band_join_directory d
    WHERE d.accepting_requests AND (p_after IS NULL OR d.band_id>p_after)
    ORDER BY d.band_id LIMIT p_limit;
END;
$reference_discover$;
  reference_request CONSTANT text := $reference_request$
DECLARE actor UUID := auth.uid(); request_id UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  IF p_applicant_name IS NULL OR length(btrim(p_applicant_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid applicant name';
  END IF;

  -- Quotas rely on fresh snapshots after serializing the applicant. REPEATABLE
  -- READ can retain a snapshot predating another committed request across bands.
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Entry requests require READ COMMITTED';
  END IF;
  -- Nonblocking serialization across ALL bands for this applicant. Hash collisions
  -- only cause conservative busy rejection; they never bypass authorization.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(824711,pg_catalog.hashtext(actor::text)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='Another entry request is in progress; refresh before retrying';
  END IF;
  PERFORM 1 FROM public.bands WHERE id=p_band_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.band_join_directory
    WHERE band_id=p_band_id AND accepting_requests) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable for requests';
  END IF;
  IF EXISTS (SELECT 1 FROM public.band_members WHERE band_id=p_band_id AND user_id=actor) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Already a band member';
  END IF;

  -- Preserve duplicate-pending error before evaluating quotas/cooldown.
  IF EXISTS(SELECT 1 FROM public.band_join_requests
    WHERE band_id=p_band_id AND requester_id=actor AND status='pending') THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='An entry request is already pending';
  END IF;
  -- clock_timestamp, not caller-controlled transaction_timestamp: long-running
  -- outer transactions cannot shift the quota window. All statuses count.
  IF (SELECT count(*) FROM public.band_join_requests WHERE requester_id=actor AND status='pending')>=5
    OR (SELECT count(*) FROM public.band_join_requests WHERE requester_id=actor
      AND requested_at>=pg_catalog.clock_timestamp()-interval '24 hours')>=10
    OR EXISTS(SELECT 1 FROM public.band_join_requests WHERE requester_id=actor AND band_id=p_band_id
      AND requested_at>=pg_catalog.clock_timestamp()-interval '10 minutes') THEN
    RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Entry request limit reached; wait before requesting again';
  END IF;
  INSERT INTO public.band_join_requests(band_id,requester_id,applicant_name,requested_at)
    VALUES(p_band_id,actor,btrim(p_applicant_name),pg_catalog.clock_timestamp()) RETURNING id INTO request_id;
  RETURN request_id;
END;
$reference_request$;
  old_discovery_query CONSTANT text := $old_query$  RETURN QUERY SELECT d.band_id,d.display_name,d.summary FROM public.band_join_directory d
    WHERE d.accepting_requests AND (p_after IS NULL OR d.band_id>p_after)
    ORDER BY d.band_id LIMIT p_limit;$old_query$;
  new_discovery_query CONSTANT text := $new_query$  RETURN QUERY SELECT b.id,b.name,''::text FROM public.bands b
    WHERE p_after IS NULL OR b.id>p_after
    ORDER BY b.id LIMIT p_limit;$new_query$;
  old_request_gate CONSTANT text := $old_gate$  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.band_join_directory
    WHERE band_id=p_band_id AND accepting_requests) THEN$old_gate$;
  new_request_gate CONSTANT text := $new_gate$  IF NOT FOUND THEN$new_gate$;
  target record;
  target_oid oid;
  source_body text;
  normalized_body text;
  expected_body text;
  old_fragment text;
  new_fragment text;
  replacement_body text;
  definition text;
  replacement_definition text;
  before_metadata jsonb;
  after_metadata jsonb;
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user AND (r.rolsuper OR r.rolbypassrls)
  ) THEN RAISE EXCEPTION 'Requires the reviewed existing postgres executor; no privileges are escalated'; END IF;
  IF pg_catalog.current_setting('server_encoding') <> 'UTF8' THEN RAISE EXCEPTION 'Requires UTF8'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='authenticated' AND (r.rolsuper OR r.rolbypassrls)) THEN
    RAISE EXCEPTION 'Unexpected elevated authenticated role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.proname='bandup_search_bands') THEN
    RAISE EXCEPTION 'Unexpected competing search RPC; inspect it rather than removing an unknown object';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=pg_catalog.to_regclass('public.bands') AND a.attname='id' AND NOT a.attisdropped
      AND a.atttypid='uuid'::pg_catalog.regtype)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=pg_catalog.to_regclass('public.bands') AND a.attname='name' AND NOT a.attisdropped
        AND a.atttypid='text'::pg_catalog.regtype) THEN
    RAISE EXCEPTION 'Band ID/name schema differs from the reviewed contract';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c
    WHERE c.oid IN (pg_catalog.to_regclass('public.bands'),pg_catalog.to_regclass('public.band_members'),
      pg_catalog.to_regclass('public.band_join_requests')) AND c.relkind='r' AND c.relrowsecurity) <> 3 THEN
    RAISE EXCEPTION 'Expected existing tables with RLS enabled';
  END IF;

  -- Both replacements run in the same transaction: any failed check rolls back all DDL.
  FOR target IN SELECT * FROM (VALUES
    ('bandup_discover_bands','public.bandup_discover_bands(uuid,integer)',
      'TABLE(band_id uuid, display_name text, summary text)',true),
    ('bandup_request_entry','public.bandup_request_entry(uuid,text)','uuid',false)
  ) AS signatures(function_name, signature, result_type, discovery)
  LOOP
    IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=target.function_name) <> 1 THEN
      RAISE EXCEPTION 'Missing or overloaded RPC: %',target.function_name;
    END IF;
    target_oid := pg_catalog.to_regprocedure(target.signature);
    IF target_oid IS NULL THEN RAISE EXCEPTION 'Unexpected RPC signature: %',target.signature; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=target_oid AND p.prokind='f' AND l.lanname='plpgsql' AND p.prosecdef
        AND p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
        AND p.proconfig && ARRAY['search_path=','search_path=""']::text[]
        AND 'row_security=off'=ANY(p.proconfig)
        AND pg_catalog.pg_get_function_result(p.oid)=target.result_type
        AND ((target.discovery AND p.proretset AND p.provolatile='s'
          AND p.proargnames=ARRAY['p_after','p_limit','band_id','display_name','summary']::text[]
          AND p.pronargdefaults=2 AND pg_catalog.pg_get_expr(p.proargdefaults,0)='NULL::uuid, 20')
          OR (NOT target.discovery AND NOT p.proretset AND p.provolatile='v'
          AND p.proargnames=ARRAY['p_band_id','p_applicant_name']::text[]
          AND p.pronargdefaults=0 AND p.proargdefaults IS NULL))) THEN
      RAISE EXCEPTION 'Unexpected owner, security settings, language, arguments or return type: %',target.function_name;
    END IF;
    -- Confirm the exact ACL supplied by the Demo administrator, never repair it.
    -- NULL ACL means default PUBLIC execution and must fail this check as well.
    IF (SELECT count(*) FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target_oid) <> 2
      OR (SELECT count(DISTINCT a.grantee) FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target_oid) <> 2
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
        WHERE p.oid=target_oid AND (
          a.grantee NOT IN ((SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres'),
            (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated'))
          OR a.grantor<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')
          OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
      OR NOT pg_catalog.has_function_privilege('postgres',target_oid,'EXECUTE')
      OR NOT pg_catalog.has_function_privilege('authenticated',target_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',target_oid,'EXECUTE WITH GRANT OPTION')
      OR pg_catalog.has_function_privilege('anon',target_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role',target_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected RPC ACL or inherited execution privileges: %',target.function_name;
    END IF;
    SELECT p.prosrc,(pg_catalog.to_jsonb(p)-'prosrc'-'proargdefaults') || pg_catalog.jsonb_build_object('defaults_sql',pg_catalog.pg_get_expr(p.proargdefaults,0)) INTO source_body,before_metadata
      FROM pg_catalog.pg_proc p WHERE p.oid=target_oid;
    -- Accept line-ending serialization differences only, never changed logic/spacing.
    normalized_body := pg_catalog.replace(source_body, E'\r\n', E'\n');
    IF target.discovery THEN
      expected_body:=reference_discover; old_fragment:=old_discovery_query; new_fragment:=new_discovery_query;
    ELSE
      expected_body:=reference_request; old_fragment:=old_request_gate; new_fragment:=new_request_gate;
    END IF;
    expected_body:=pg_catalog.replace(expected_body, E'\r\n', E'\n');
    old_fragment:=pg_catalog.replace(old_fragment, E'\r\n', E'\n');
    new_fragment:=pg_catalog.replace(new_fragment, E'\r\n', E'\n');
    IF normalized_body IS DISTINCT FROM expected_body THEN
      RAISE EXCEPTION 'Installed body differs from the reviewed reference: %',target.function_name;
    END IF;
    IF (pg_catalog.length(normalized_body)-pg_catalog.length(pg_catalog.replace(normalized_body,old_fragment,'')))
      /pg_catalog.length(old_fragment) <> 1 THEN
      RAISE EXCEPTION 'Reviewed fragment must occur exactly once: %',target.function_name;
    END IF;
    replacement_body:=pg_catalog.replace(normalized_body,old_fragment,new_fragment);
    IF replacement_body ~* '(band_join_directory|accepting_requests)' THEN
      RAISE EXCEPTION 'Legacy directory dependency remains: %',target.function_name;
    END IF;
    definition:=pg_catalog.pg_get_functiondef(target_oid);
    IF (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,source_body,'')))
      /pg_catalog.length(source_body) <> 1 THEN
      RAISE EXCEPTION 'Cannot safely locate the full source body: %',target.function_name;
    END IF;
    -- Reuse the installed CREATE OR REPLACE header; never reconstruct grants/settings.
    replacement_definition:=pg_catalog.replace(definition,source_body,replacement_body);
    EXECUTE replacement_definition;
    SELECT (pg_catalog.to_jsonb(p)-'prosrc'-'proargdefaults') || pg_catalog.jsonb_build_object('defaults_sql',pg_catalog.pg_get_expr(p.proargdefaults,0)) INTO after_metadata
      FROM pg_catalog.pg_proc p WHERE p.oid=target_oid AND p.prosrc=replacement_body;
    IF after_metadata IS DISTINCT FROM before_metadata THEN
      RAISE EXCEPTION 'RPC metadata changed; abort instead of altering unrelated guarantees: %',target.function_name;
    END IF;
    -- Verify effective privileges after replacement too, not just direct proacl.
    IF NOT pg_catalog.has_function_privilege('postgres',target_oid,'EXECUTE')
      OR NOT pg_catalog.has_function_privilege('authenticated',target_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',target_oid,'EXECUTE WITH GRANT OPTION')
      OR pg_catalog.has_function_privilege('anon',target_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role',target_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Unexpected effective RPC privileges after replacement: %',target.function_name;
    END IF;
  END LOOP;
END;
$review$;
COMMIT;
