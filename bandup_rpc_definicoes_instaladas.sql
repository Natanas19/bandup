-- Definicoes extraidas do diagnostico fornecido pelo usuario. REFERENCIA APENAS. NAO EXECUTAR.

-- public.bandup_discover_bands(p_after uuid, p_limit integer)
CREATE OR REPLACE FUNCTION public.bandup_discover_bands(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(band_id uuid, display_name text, summary text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Limit must be between 1 and 50';
  END IF;
  RETURN QUERY SELECT d.band_id,d.display_name,d.summary FROM public.band_join_directory d
    WHERE d.accepting_requests AND (p_after IS NULL OR d.band_id>p_after)
    ORDER BY d.band_id LIMIT p_limit;
END;
$function$

-- public.bandup_request_entry(p_band_id uuid, p_applicant_name text)
CREATE OR REPLACE FUNCTION public.bandup_request_entry(p_band_id uuid, p_applicant_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
$function$

