-- Candidate only. Before applying, compare both installed definitions with the
-- local baseline and verify the project's avatars origin. Existing owners and ACLs
-- are preserved. Each returned public URL necessarily includes the musician UUID.
BEGIN;
SET LOCAL search_path = pg_catalog;

-- Require both existing RPCs so this patch cannot create functions with default ACLs.
DO $preflight$
BEGIN
  PERFORM 'public.bandup_discover_musicians(text,integer,integer)'::regprocedure;
  PERFORM 'public.bandup_discover_musicians_for_invites(text,integer,integer)'::regprocedure;
END $preflight$;

CREATE OR REPLACE FUNCTION public.bandup_discover_musicians(
  p_query text DEFAULT '', p_offset integer DEFAULT 0, p_limit integer DEFAULT 20
)
RETURNS TABLE(display_name text, photo_ref text, available boolean)
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
  SELECT names.name,
    CASE WHEN a.available IS TRUE AND pg_catalog.btrim(p_query) <> ''
      AND pg_catalog.jsonb_typeof(u.raw_user_meta_data -> 'avatar_url') = 'string'
      AND pg_catalog.starts_with(photo.url, photo.owner_prefix)
      AND pg_catalog.substr(photo.url, pg_catalog.length(photo.owner_prefix) + 1)
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      THEN photo.url ELSE NULL::text END,
    COALESCE(a.available, false)
  FROM auth.users u
  CROSS JOIN LATERAL (SELECT
    u.raw_user_meta_data ->> 'avatar_url' AS url,
    'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/avatars/' || u.id::text || '/' AS owner_prefix
  ) photo
  CROSS JOIN LATERAL (SELECT u.raw_user_meta_data ->> 'display_name' AS name) raw
  CROSS JOIN LATERAL (SELECT pg_catalog.btrim(pg_catalog.left(raw.name, 81)) AS name) clean
  CROSS JOIN LATERAL (SELECT CASE
    WHEN pg_catalog.jsonb_typeof(u.raw_user_meta_data -> 'display_name') = 'string'
      AND pg_catalog.char_length(raw.name) BETWEEN 1 AND 80
      AND pg_catalog.char_length(clean.name) BETWEEN 1 AND 80
      AND raw.name !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'
      AND raw.name !~ '[<>@]'
      AND clean.name !~ U&'^[\0020\00A0\1680\2000-\200D\2028\2029\202F\205F\2060\3000\FEFF\FE00-\FE0F\+0E0100-\+0E01EF]*$'
    THEN clean.name ELSE 'Músico'::text END AS name) names
  LEFT JOIN public.musician_availability a ON a.user_id = u.id
  -- Literal substring, not LIKE: %, _ and backslash have no wildcard meaning.
  WHERE pg_catalog.strpos(pg_catalog.lower(names.name), pg_catalog.lower(pg_catalog.btrim(p_query))) > 0
  ORDER BY u.id
  LIMIT p_limit OFFSET p_offset;
END $function$;

CREATE OR REPLACE FUNCTION public.bandup_discover_musicians_for_invites(
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
  SELECT names.name,
    CASE WHEN a.available IS TRUE AND pg_catalog.btrim(p_query) <> ''
      AND pg_catalog.jsonb_typeof(u.raw_user_meta_data -> 'avatar_url') = 'string'
      AND pg_catalog.starts_with(photo.url, photo.owner_prefix)
      AND pg_catalog.substr(photo.url, pg_catalog.length(photo.owner_prefix) + 1)
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      THEN photo.url ELSE NULL::text END,
    COALESCE(a.available, false), CASE WHEN a.available AND u.id <> actor THEN refs.musician_ref ELSE NULL::uuid END
  FROM auth.users u
  CROSS JOIN LATERAL (SELECT
    u.raw_user_meta_data ->> 'avatar_url' AS url,
    'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/avatars/' || u.id::text || '/' AS owner_prefix
  ) photo
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

COMMIT;
