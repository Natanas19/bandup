-- LOCAL CANDIDATE ONLY. Never apply to Demo or use db push/repair automatically.
-- Requires separately reviewed band_members write hardening. No frontend activation.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Installation requires READ COMMITTED';
  END IF;
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'Reviewed postgres executor required'; END IF;
  IF has_table_privilege('authenticated','public.band_members','INSERT,UPDATE')
    OR has_any_column_privilege('authenticated','public.band_members','INSERT,UPDATE')
    OR has_table_privilege('anon','public.band_members','INSERT,UPDATE')
    OR has_any_column_privilege('anon','public.band_members','INSERT,UPDATE')
  THEN RAISE EXCEPTION 'band_members hardening required first'; END IF;
  IF to_regprocedure('public.bandup_decide_entry(uuid,text)') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL
    OR to_regclass('public.musician_availability') IS NULL
  THEN RAISE EXCEPTION 'Missing existing contracts'; END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.band_join_requests'::regclass
    AND conname='band_join_requests_status_check' AND contype='c')
    OR NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.band_join_requests'::regclass
    AND conname='band_join_requests_check' AND contype='c')
    OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.band_join_requests'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) ~ '\mstatus\M') <> 2
  THEN RAISE EXCEPTION 'Unexpected request checks; review instead of repairing'; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('authenticated','anon') AND (rolsuper OR rolbypassrls))
  THEN RAISE EXCEPTION 'Unexpected client bypass'; END IF;
  IF pg_has_role('authenticated','postgres','MEMBER') OR pg_has_role('anon','postgres','MEMBER') THEN
    RAISE EXCEPTION 'Client reaches definer owner'; END IF;
END $preflight$;

-- Compare parsed checks, not only their names: unexpected business rules must abort.
CREATE TEMP TABLE bandup_invitation_expected_request_checks (
  status text,decided_at timestamptz,decided_by uuid,cancelled_at timestamptz,
  CHECK(status IN ('pending','approved','rejected','cancelled')),
  CHECK((status='pending' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NULL)
    OR (status IN ('approved','rejected') AND decided_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NOT NULL))
) ON COMMIT DROP;
DO $checks$
BEGIN
  IF EXISTS (
    (SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint
      WHERE conrelid='public.band_join_requests'::regclass AND conname IN ('band_join_requests_status_check','band_join_requests_check')
    EXCEPT SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint
      WHERE conrelid='pg_temp.bandup_invitation_expected_request_checks'::regclass)
    UNION ALL
    (SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint
      WHERE conrelid='pg_temp.bandup_invitation_expected_request_checks'::regclass
    EXCEPT SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint
      WHERE conrelid='public.band_join_requests'::regclass AND conname IN ('band_join_requests_status_check','band_join_requests_check'))
  ) THEN RAISE EXCEPTION 'Request check definitions diverge from reviewed local contract'; END IF;
END $checks$;

CREATE TABLE private.musician_invitation_refs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  musician_ref uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  CHECK (musician_ref <> user_id)
);
ALTER TABLE private.musician_invitation_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.musician_invitation_refs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.ensure_musician_invitation_ref() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $$
BEGIN
  IF NEW.available THEN
    INSERT INTO private.musician_invitation_refs(user_id) VALUES(NEW.user_id) ON CONFLICT(user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.ensure_musician_invitation_ref() FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.band_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  CHECK(invited_by IS NULL OR invited_by <> recipient_id),
  CHECK((status='pending' AND decided_at IS NULL)
    OR (status<>'pending' AND decided_at IS NOT NULL AND decided_at>=created_at))
);
ALTER TABLE public.band_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.band_invitations FROM PUBLIC,anon,authenticated,service_role;
-- No client policies: listings deliberately use checked, narrow RPC projections.
CREATE UNIQUE INDEX band_invitations_one_pending ON public.band_invitations(band_id,recipient_id) WHERE status='pending';
CREATE INDEX band_invitations_recipient ON public.band_invitations(recipient_id,created_at DESC,id);
CREATE INDEX band_invitations_band_time ON public.band_invitations(band_id,created_at DESC);
CREATE INDEX band_invitations_sender_time ON public.band_invitations(invited_by,created_at DESC);

ALTER TABLE public.band_join_requests DROP CONSTRAINT band_join_requests_status_check;
ALTER TABLE public.band_join_requests DROP CONSTRAINT band_join_requests_check;
ALTER TABLE public.band_join_requests ADD CONSTRAINT band_join_requests_status_check
CHECK(status IN ('pending','approved','rejected','cancelled','superseded'));
ALTER TABLE public.band_join_requests ADD CONSTRAINT band_join_requests_check CHECK (
  (status='pending' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NULL)
  OR (status IN ('approved','rejected','superseded') AND decided_at IS NOT NULL AND cancelled_at IS NULL)
  OR (status='cancelled' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NOT NULL)
);

CREATE FUNCTION private.invitation_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET row_security=off AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS(SELECT FROM auth.users WHERE id=actor)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitations unavailable'; END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION private.invitation_actor() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.bandup_invite_musician(p_band_id uuid,p_musician_ref uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off SET lock_timeout='3s' AS $$
DECLARE actor uuid := private.invitation_actor(); recipient uuid; invitation uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='READ COMMITTED required'; END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(824712,pg_catalog.hashtext(actor::text)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='Invitation busy'; END IF;
  PERFORM 1 FROM public.bands WHERE id=p_band_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitations unavailable'; END IF;
  PERFORM 1 FROM public.band_members WHERE band_id=p_band_id AND user_id=actor AND role='admin' FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitations unavailable'; END IF;
  SELECT r.user_id INTO recipient FROM private.musician_invitation_refs r
    JOIN public.musician_availability a ON a.user_id=r.user_id
    WHERE r.musician_ref=p_musician_ref AND a.available FOR UPDATE OF a NOWAIT;
  IF recipient IS NULL OR recipient=actor THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitations unavailable'; END IF;
  IF EXISTS(SELECT FROM public.band_members WHERE band_id=p_band_id AND user_id=recipient)
    OR EXISTS(SELECT FROM public.band_invitations WHERE band_id=p_band_id AND recipient_id=recipient AND status='pending')
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Membership or invitation already exists'; END IF;
  IF (SELECT count(*) FROM public.band_invitations WHERE band_id=p_band_id AND status='pending')>=5
    OR (SELECT count(*) FROM public.band_invitations WHERE band_id=p_band_id AND created_at>=clock_timestamp()-interval '24 hours')>=10
    OR (SELECT count(*) FROM public.band_invitations WHERE invited_by=actor AND created_at>=clock_timestamp()-interval '24 hours')>=10
    OR EXISTS(SELECT FROM public.band_invitations WHERE band_id=p_band_id AND recipient_id=recipient
      AND created_at>=clock_timestamp()-interval '24 hours')
  THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Invitation limit reached'; END IF;
  INSERT INTO public.band_invitations(band_id,recipient_id,invited_by) VALUES(p_band_id,recipient,actor) RETURNING id INTO invitation;
  RETURN invitation;
END $$;

CREATE FUNCTION public.bandup_decide_invitation(p_invitation_id uuid,p_decision text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off SET lock_timeout='3s' AS $$
DECLARE actor uuid := private.invitation_actor(); invitation public.band_invitations%ROWTYPE;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('accepted','rejected') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid invitation decision'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='READ COMMITTED required'; END IF;
  SELECT * INTO invitation FROM public.band_invitations WHERE id=p_invitation_id AND recipient_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitations unavailable'; END IF;
  PERFORM 1 FROM public.bands WHERE id=invitation.band_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitations unavailable'; END IF;
  SELECT * INTO invitation FROM public.band_invitations WHERE id=p_invitation_id AND recipient_id=actor FOR UPDATE NOWAIT;
  IF NOT FOUND OR invitation.status<>'pending' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Invitation already completed'; END IF;
  IF p_decision='accepted' THEN
    -- Lock requests without waiting: legacy approval may already hold their row locks.
    PERFORM 1 FROM public.band_join_requests WHERE band_id=invitation.band_id AND requester_id=actor AND status='pending'
      ORDER BY id FOR UPDATE NOWAIT;
    IF EXISTS(SELECT FROM public.band_members WHERE band_id=invitation.band_id AND user_id=actor) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Already a member'; END IF;
    INSERT INTO public.band_members(band_id,user_id,role) VALUES(invitation.band_id,actor,'member');
    UPDATE public.band_join_requests SET status='superseded',decided_at=clock_timestamp(),decided_by=actor
      WHERE band_id=invitation.band_id AND requester_id=actor AND status='pending';
  END IF;
  UPDATE public.band_invitations SET status=p_decision,decided_at=clock_timestamp() WHERE id=p_invitation_id;
  RETURN p_decision;
END $$;

-- Serialize approvals with invitation decisions without changing the legacy RPC body.
CREATE FUNCTION private.lock_invitation_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $$
BEGIN
  IF NEW.status='approved' AND OLD.status='pending' THEN
    IF current_setting('transaction_isolation')<>'read committed' THEN
      RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='READ COMMITTED required'; END IF;
    PERFORM 1 FROM public.bands WHERE id=NEW.band_id FOR UPDATE NOWAIT;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER band_requests_lock_invitation_approval BEFORE UPDATE OF status ON public.band_join_requests
FOR EACH ROW EXECUTE FUNCTION private.lock_invitation_approval();

-- Deferred so both legacy orderings (membership first / request first) work.
CREATE FUNCTION private.supersede_invitations_after_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $$
BEGIN
  IF NEW.status='approved' AND OLD.status='pending' THEN
    IF NOT EXISTS(SELECT FROM public.band_members WHERE band_id=NEW.band_id AND user_id=NEW.requester_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Approval requires membership'; END IF;
    PERFORM 1 FROM public.band_invitations WHERE band_id=NEW.band_id AND recipient_id=NEW.requester_id AND status='pending'
      ORDER BY id FOR UPDATE NOWAIT;
    UPDATE public.band_invitations SET status='superseded',decided_at=clock_timestamp()
      WHERE band_id=NEW.band_id AND recipient_id=NEW.requester_id AND status='pending';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER band_requests_supersede_invitations AFTER UPDATE ON public.band_join_requests
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.supersede_invitations_after_approval();
REVOKE ALL ON FUNCTION private.lock_invitation_approval(),private.supersede_invitations_after_approval()
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.bandup_list_invitations(p_band_id uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20)
RETURNS TABLE(invitation_id uuid,band_id uuid,band_name text,musician_ref uuid,status text,created_at timestamptz,decided_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET row_security=off AS $$
DECLARE actor uuid := private.invitation_actor();
BEGIN
  IF p_offset IS NULL OR p_offset<0 OR p_offset>10000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pagination'; END IF;
  IF p_band_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.band_members
    WHERE band_members.band_id=p_band_id AND user_id=actor AND role='admin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitations unavailable'; END IF;
  RETURN QUERY SELECT i.id,i.band_id,b.name,r.musician_ref,i.status,i.created_at,i.decided_at
    FROM public.band_invitations i JOIN public.bands b ON b.id=i.band_id
    JOIN private.musician_invitation_refs r ON r.user_id=i.recipient_id
    WHERE (p_band_id IS NULL AND i.recipient_id=actor) OR (p_band_id IS NOT NULL AND i.band_id=p_band_id)
    ORDER BY i.created_at DESC,i.id DESC LIMIT p_limit OFFSET p_offset;
END $$;

REVOKE ALL ON FUNCTION public.bandup_invite_musician(uuid,uuid),public.bandup_decide_invitation(uuid,text),
  public.bandup_list_invitations(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bandup_invite_musician(uuid,uuid),public.bandup_decide_invitation(uuid,text),
  public.bandup_list_invitations(uuid,integer,integer) TO authenticated;
CREATE FUNCTION public.bandup_discover_musicians_for_invites(
  p_query text DEFAULT '', p_offset integer DEFAULT 0, p_limit integer DEFAULT 20
)
RETURNS TABLE(display_name text, photo_ref text, available boolean, musician_ref uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Musician discovery unavailable';
  END IF;
  IF p_query IS NULL OR pg_catalog.char_length(p_query) > 100
    OR p_offset IS NULL OR p_offset < 0
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid musician search parameters';
  END IF;
  RETURN QUERY
  SELECT names.name, NULL::text, COALESCE(a.available, false), CASE WHEN a.available AND u.id <> actor THEN refs.musician_ref ELSE NULL::uuid END
  FROM auth.users u
  CROSS JOIN LATERAL (SELECT u.raw_user_meta_data ->> 'display_name' AS name) raw
  CROSS JOIN LATERAL (SELECT pg_catalog.btrim(pg_catalog.left(raw.name, 81)) AS name) clean
  CROSS JOIN LATERAL (SELECT CASE
    WHEN pg_catalog.jsonb_typeof(u.raw_user_meta_data -> 'display_name') = 'string'
      AND pg_catalog.char_length(raw.name) BETWEEN 1 AND 80
      AND pg_catalog.char_length(clean.name) BETWEEN 1 AND 80
      AND raw.name !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'
      AND raw.name !~ '[<>@]'
      AND clean.name !~ U&'^[\0020\00A0\1680\2000-\200D\2028\2029\202F\205F\2060\3000\FEFF\FE00-\FE0F\+0E0100-\+0E01EF]*$'
    THEN clean.name ELSE 'MÃºsico'::text END AS name) names
  LEFT JOIN public.musician_availability a ON a.user_id = u.id LEFT JOIN private.musician_invitation_refs refs ON refs.user_id=u.id
  -- Literal substring, not LIKE: %, _ and backslash have no wildcard meaning.
  WHERE pg_catalog.strpos(pg_catalog.lower(names.name), pg_catalog.lower(pg_catalog.btrim(p_query))) > 0
  ORDER BY u.id
  LIMIT p_limit OFFSET p_offset;
END $function$;

ALTER FUNCTION public.bandup_discover_musicians_for_invites(text,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_discover_musicians_for_invites(text,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_discover_musicians_for_invites(text,integer,integer) TO authenticated;


DO $acl$
DECLARE target regclass; func regprocedure;
BEGIN
  FOREACH target IN ARRAY ARRAY['public.band_invitations'::regclass,'private.musician_invitation_refs'::regclass] LOOP
    IF EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid=target AND a.grantee<>'postgres'::regrole) THEN
      RAISE EXCEPTION 'Unexpected default table ACL'; END IF;
  END LOOP;
  FOREACH func IN ARRAY ARRAY['public.bandup_invite_musician(uuid,uuid)'::regprocedure,
    'public.bandup_decide_invitation(uuid,text)'::regprocedure,'public.bandup_list_invitations(uuid,integer,integer)'::regprocedure,
    'public.bandup_discover_musicians_for_invites(text,integer,integer)'::regprocedure] LOOP
    IF EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid=func
      AND (a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.is_grantable AND a.grantee<>'postgres'::regrole)) THEN
      RAISE EXCEPTION 'Unexpected default function ACL'; END IF;
  END LOOP;
END $acl$;
-- CREATE TRIGGER obtains SHARE ROW EXCLUSIVE on availability until COMMIT.
-- Install last, before backfill: drain existing writers, block new writers, then
-- use a fresh READ COMMITTED statement snapshot to include their committed rows.
-- No broader explicit lock; SELECT remains available. Timeout aborts everything.
CREATE TRIGGER musician_availability_invitation_ref AFTER INSERT OR UPDATE OF available
ON public.musician_availability FOR EACH ROW EXECUTE FUNCTION private.ensure_musician_invitation_ref();
-- Keep backfill as a separate statement: its snapshot must follow lock acquisition.
INSERT INTO private.musician_invitation_refs(user_id)
  SELECT user_id FROM public.musician_availability WHERE available;
COMMIT;
