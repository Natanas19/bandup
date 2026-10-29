-- FUTURE historical phase only. Mutation success is required before checking.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
\ir historical_lab_identity_check.sql
\ir historical_public_read_layer_contract.sql
SELECT pg_temp.historical_check();
CREATE FUNCTION pg_temp.historical_reject(mutation text, expected_message text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $reject$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    EXECUTE mutation; -- Outside the rejection handler: failed setup must fail.
    BEGIN
      PERFORM pg_temp.historical_check();
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM<>expected_message THEN RAISE; END IF;
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Historical checker accepted drift: %',mutation; END IF;
    RAISE SQLSTATE 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; -- Undo mutation and nested effects.
  END;
  PERFORM pg_temp.historical_check();
END;
$reject$;
SELECT pg_temp.historical_reject('ALTER POLICY events_select_for_public_reader ON public.events USING (EXISTS (SELECT 1 FROM public.bands band WHERE band.id=events.band_id AND band.is_public IS TRUE))','Historical contract: policy events');
SELECT pg_temp.historical_reject('ALTER POLICY events_select_for_public_reader ON public.events USING (true)','Historical contract: policy events');
SELECT pg_temp.historical_reject('CREATE POLICY historical_extra_public ON public.events FOR SELECT TO PUBLIC USING (true)','Historical contract: PUBLIC policy');
SELECT pg_temp.historical_reject('REVOKE CREATE ON SCHEMA public FROM bandup_public_reader','Historical contract: persistent CREATE');
-- Effective USAGE deliberately remains available via PUBLIC in this mutation.
SELECT pg_temp.historical_reject('GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE USAGE ON SCHEMA public FROM bandup_public_reader','Historical contract: direct schema ACL bandup_public_reader/public');
SELECT pg_temp.historical_reject('REVOKE USAGE ON SCHEMA public FROM anon','Historical contract: direct schema ACL anon/public');
SELECT pg_temp.historical_reject('REVOKE USAGE ON SCHEMA auth FROM anon','Historical contract: direct schema ACL anon/auth');
SELECT pg_temp.historical_reject('REVOKE USAGE ON SCHEMA public FROM authenticated','Historical contract: direct schema ACL authenticated/public');
SELECT pg_temp.historical_reject('REVOKE USAGE ON SCHEMA auth FROM authenticated','Historical contract: direct schema ACL authenticated/auth');
SELECT pg_temp.historical_reject('REVOKE USAGE ON SCHEMA private FROM authenticated','Historical contract: direct schema ACL authenticated/private');
SELECT pg_temp.historical_reject('REVOKE USAGE ON SCHEMA public FROM service_role','Historical contract: direct schema ACL service_role/public');
SELECT pg_temp.historical_reject('REVOKE USAGE ON SCHEMA auth FROM service_role','Historical contract: direct schema ACL service_role/auth');
SELECT pg_temp.historical_reject('REVOKE bandup_public_reader FROM CURRENT_USER','Historical contract: reader membership');
SELECT pg_temp.historical_reject('GRANT bandup_public_reader TO CURRENT_USER WITH ADMIN TRUE','Historical contract: reader membership');
SELECT pg_temp.historical_reject('GRANT bandup_public_reader TO CURRENT_USER WITH INHERIT FALSE','Historical contract: reader membership');
SELECT pg_temp.historical_reject('GRANT bandup_public_reader TO CURRENT_USER WITH SET FALSE','Historical contract: reader membership');
SELECT pg_temp.historical_reject('GRANT authenticated TO bandup_public_reader','Historical contract: reader membership');
SELECT pg_temp.historical_reject('ALTER ROLE bandup_public_reader BYPASSRLS','Historical contract: reader flags');
SELECT pg_temp.historical_reject('GRANT SELECT ON public.events TO bandup_public_reader','Historical contract: reader table/write grants');
SELECT pg_temp.historical_reject('GRANT SELECT(id) ON public.social_links TO bandup_public_reader','Historical contract: reader column grants');
SELECT pg_temp.historical_reject('REVOKE SELECT(url) ON public.social_links FROM bandup_public_reader','Historical contract: reader column grants');
SELECT pg_temp.historical_reject('GRANT UPDATE(url) ON public.social_links TO bandup_public_reader','Historical contract: reader table/write grants');
SELECT pg_temp.historical_reject('ALTER TABLE public.events DISABLE ROW LEVEL SECURITY','Historical contract: source RLS/owner');
SELECT pg_temp.historical_reject('ALTER TABLE public.events OWNER TO bandup_public_reader','Historical contract: source RLS/owner');
SELECT pg_temp.historical_reject('ALTER POLICY events_select_for_public_reader ON public.events TO authenticated','Historical contract: policy inventory');
SELECT pg_temp.historical_reject('GRANT SELECT(title) ON public.events TO anon','Historical contract: anonymous source access');
SELECT pg_temp.historical_reject('GRANT SELECT ON public.public_events TO authenticated','Historical contract: view ACL public_events');
SELECT pg_temp.historical_reject('GRANT SELECT ON public.public_bands TO PUBLIC','Historical contract: view ACL public_bands');
SELECT pg_temp.historical_reject('ALTER VIEW public.public_events SET (security_invoker=true)','Historical contract: view definition public_events');
SELECT pg_temp.historical_reject('ALTER VIEW public.public_events OWNER TO CURRENT_USER','Historical contract: view definition public_events');
SELECT pg_temp.historical_reject('CREATE OR REPLACE VIEW public.public_events WITH (security_barrier=true,security_invoker=false) AS SELECT band_id,title,event_type,start_at,end_at,location FROM public.events WHERE EXISTS (SELECT 1 FROM public.bands band WHERE band.id=events.band_id AND band.is_public IS TRUE)','Historical contract: view definition public_events');
SELECT pg_temp.historical_check();
ROLLBACK;
