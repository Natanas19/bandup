-- LOCAL CANDIDATE ONLY: emergency post-COMMIT containment, not an installation.
-- Local validation (2026-11-17): 8/8 containment scenarios passed on disposable
-- PostgreSQL 17. No API/cache/privileged-wrapper or remote certification implied.
-- Reproduce only this selection (PowerShell, explicit disposable-cluster opt-in):
-- $env:BANDUP_INVITATIONS_LOCAL_TESTS='create-isolated-cluster'
-- node tests/postgres/band-invitations-isolated.cjs --execute --containment
-- No remote execution authorized. Run the whole transaction with stop-on-error.
-- Record destination, authorization, SHA-256, original ACLs and COMMIT outcome.
-- Coordinate exclusive administrative access to these ACLs/roles during execution:
-- this script does not serialize concurrent GRANT, role changes or function DDL.
-- Gate: review indirect SECURITY DEFINER/wrapper entry points separately. Catalog
-- ACL checks cannot prove that no privileged wrapper calls these functions.
-- Unexpected PUBLIC/other-role grants abort; never broaden revocations to pass.
-- Only authenticated EXECUTE on the two exact signatures is revoked, RESTRICT.
-- Re-running while already contained is permitted; it does not authorize restore.
--
-- Verification after confirmed COMMIT, in a new authorized session:
-- * confirm no EXECUTE for authenticated/anon or any role they can reach;
-- * confirm the only target ACL is postgres EXECUTE (owner rights preserved);
-- * verify both direct API calls fail permission checks for real client sessions;
-- * confirm unrelated list/discovery/legacy RPCs and hardening are unchanged;
-- * inspect in-flight transactions before declaring containment complete.
-- REVOKE does not cancel admitted/running calls or roll back uncommitted decisions.
-- Prepared statements and old client sessions require verification too. Owners,
-- superusers and privileged wrappers are outside this client containment boundary.
-- Decision containment blocks BOTH accepted and rejected; pending rows stay pending
-- unless another legitimate path changes/removes them. Approval triggers and FK
-- CASCADE remain active. No data/history, memberships, functions or RLS are changed.
-- A disabled frontend flag is not an API permission barrier.
--
-- Recovery requires NEW authorization and a separately reviewed artifact, not a
-- ROLLBACK after COMMIT. Preserve all data, constraints and band_members hardening.
-- Restore only authenticated EXECUTE on these signatures that was actually present
-- in the recorded pre-containment state, without grant option. Do not restore
-- PUBLIC/anon/service_role/other-role grants or add access on an already-contained
-- run. Reconcile uncertain decisions before reopening; no automatic mutation retry.
-- Verify exact ACLs and API behavior before frontend rebuild/deploy authorization.
-- If connection is lost at COMMIT, inspect persisted ACLs before retry or restore.
-- On any error stop, ROLLBACK and report failure; neither RPC is then contained by
-- this attempt. Timeouts bound individual waits/statements, not the transaction.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $containment$
DECLARE
  target regprocedure;
  targets regprocedure[];
  client_role record;
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Reviewed postgres executor with existing RLS bypass required';
  END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated')
    OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN
    RAISE EXCEPTION 'Missing client roles';
  END IF;
  IF to_regprocedure('public.bandup_invite_musician(uuid,uuid)') IS NULL
    OR to_regprocedure('public.bandup_decide_invitation(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Backend missing; do not install or repair during containment';
  END IF;
  targets := ARRAY['public.bandup_invite_musician(uuid,uuid)'::regprocedure,
    'public.bandup_decide_invitation(uuid,text)'::regprocedure];

  -- MEMBER is deliberately conservative: also reject possible SET ROLE paths,
  -- even if NOINHERIT prevents automatic inheritance in the current session.
  FOR client_role IN SELECT * FROM pg_roles r WHERE r.rolname IN ('authenticated','anon')
    OR pg_has_role('authenticated',r.oid,'MEMBER') OR pg_has_role('anon',r.oid,'MEMBER')
  LOOP
    IF client_role.rolsuper OR client_role.rolbypassrls OR client_role.rolcreaterole
      OR client_role.rolname='postgres' THEN
      RAISE EXCEPTION 'Client reaches privileged role %; REVOKE-only containment unsafe',client_role.rolname;
    END IF;
  END LOOP;

  FOREACH target IN ARRAY targets LOOP
    IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=target AND prokind='f'
      AND proowner='postgres'::regrole AND prosecdef)
      OR NOT EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL
        aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=target AND a.grantee='postgres'::regrole
          AND a.grantor='postgres'::regrole AND a.privilege_type='EXECUTE')
      OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL
        aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE p.oid=target AND (a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole)
          OR a.grantor<>'postgres'::regrole OR a.privilege_type<>'EXECUTE'
          OR (a.grantee='authenticated'::regrole AND a.is_grantable))) THEN
      RAISE EXCEPTION 'Unexpected owner/definer/ACL for %; review, do not broaden REVOKE',target;
    END IF;
    RAISE NOTICE 'Before containment: %, ACL=%',target,(SELECT proacl FROM pg_proc WHERE oid=target);
  END LOOP;

  REVOKE EXECUTE ON FUNCTION public.bandup_invite_musician(uuid,uuid),
    public.bandup_decide_invitation(uuid,text) FROM authenticated RESTRICT;

  FOREACH target IN ARRAY targets LOOP
    FOR client_role IN SELECT oid,rolname FROM pg_roles r WHERE r.rolname IN ('authenticated','anon')
      OR pg_has_role('authenticated',r.oid,'MEMBER') OR pg_has_role('anon',r.oid,'MEMBER')
    LOOP
      IF has_function_privilege(client_role.oid,target,'EXECUTE') THEN
        RAISE EXCEPTION 'Residual EXECUTE via % on %; entire containment rolled back',client_role.rolname,target;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid=target) <> 1 OR EXISTS (
      SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=target
      AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole
        OR a.privilege_type<>'EXECUTE')
    ) THEN RAISE EXCEPTION 'Unexpected post-containment ACL for %',target; END IF;
  END LOOP;
END $containment$;
COMMIT;
