-- PHASE 2: COUNTS AND LEGACY INVENTORY. PREPARED, NOT AUTHORIZED TO EXECUTE.
-- Separate approval required AFTER Phase 1 review of identity, types, roles,
-- physical relation kinds, indexes and all indirect execution paths.
-- READ ONLY cannot prevent external effects from unexpected custom code.
-- row_security=off does NOT bypass RLS: it fails if RLS would filter rows.
-- Fresh dedicated PostgreSQL 15+ session; stop on first error; no automatic retries.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

SET LOCAL row_security = off;

-- B: history versions ONLY. Never read names/statements/checksums from unknown
-- extensions of the ledger. Version strings must have the expected safe format.
SELECT CASE WHEN version::text ~ '^[0-9]{14}$' THEN version::text
            ELSE '<nonstandard-version>' END AS version,
       pg_catalog.count(*) AS entries
FROM supabase_migrations.schema_migrations GROUP BY 1 ORDER BY 1;

-- C1: aggregate source counts. No auth.users, emails, identifiers or raw URLs.
SELECT 'bands' AS relation_name, pg_catalog.count(*) AS visible_rows FROM public.bands
UNION ALL SELECT 'band_members',pg_catalog.count(*) FROM public.band_members
UNION ALL SELECT 'social_links',pg_catalog.count(*) FROM public.social_links
UNION ALL SELECT 'tasks',pg_catalog.count(*) FROM public.tasks
UNION ALL SELECT 'events',pg_catalog.count(*) FROM public.events;

-- C2: exact ECMAScript whitespace/UTF-16 rules of Migration 10.
WITH whitespace AS (
 SELECT pg_catalog.string_agg(pg_catalog.chr(cp),'') AS chars FROM pg_catalog.unnest(ARRAY[
 9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,
 8232,8233,8239,8287,12288,65279]) AS codepoints(cp)
), fields(field_name,value) AS (
 SELECT 'bands.name',name FROM public.bands
 UNION ALL SELECT 'bands.slug',slug FROM public.bands
 UNION ALL SELECT 'tasks.title',title FROM public.tasks
 UNION ALL SELECT 'events.title',title FROM public.events
 UNION ALL SELECT 'events.event_type',event_type FROM public.events
 UNION ALL SELECT 'social_links.platform',platform FROM public.social_links
)
SELECT field_name, pg_catalog.count(*) AS visible_rows,
       pg_catalog.count(*) FILTER (WHERE value IS NULL) AS null_values,
       pg_catalog.count(*) FILTER (WHERE pg_catalog.btrim(value,w.chars)='') AS blank_values
FROM fields CROSS JOIN whitespace w GROUP BY field_name ORDER BY 1;

WITH whitespace AS (
 SELECT pg_catalog.string_agg(pg_catalog.chr(cp),'') AS chars FROM pg_catalog.unnest(ARRAY[
 9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,
 8232,8233,8239,8287,12288,65279]) AS codepoints(cp)
), measured AS (
 SELECT b.slug,b.is_public,w.chars,
  pg_catalog.char_length(b.slug)+(SELECT pg_catalog.count(*) FROM pg_catalog.generate_series(1,least(pg_catalog.char_length(b.slug),2048)) AS pos(i)
    WHERE pg_catalog.ascii(pg_catalog.substr(b.slug,pos.i,1))>65535) AS utf16_units
 FROM public.bands b CROSS JOIN whitespace w
), classified AS (
 SELECT *, slug IS NULL OR pg_catalog.btrim(slug,chars)='' OR slug IN ('.','..')
  OR slug COLLATE "C" ~ '[[:cntrl:]]' OR utf16_units>2048 AS incompatible
 FROM measured
)
SELECT pg_catalog.count(*) AS visible_bands,
       pg_catalog.count(*) FILTER (WHERE incompatible) AS incompatible_slugs,
       pg_catalog.count(*) FILTER (WHERE incompatible AND is_public) AS published_incompatible_slugs
FROM classified;

-- C3: finite timestamps. Past events are NOT inherently corrupt legacy rows.
WITH times(field_name,value) AS (
 SELECT 'bands.created_at',created_at FROM public.bands
 UNION ALL SELECT 'bands.updated_at',updated_at FROM public.bands
 UNION ALL SELECT 'band_members.created_at',created_at FROM public.band_members
 UNION ALL SELECT 'social_links.created_at',created_at FROM public.social_links
 UNION ALL SELECT 'tasks.created_at',created_at FROM public.tasks
 UNION ALL SELECT 'tasks.updated_at',updated_at FROM public.tasks
 UNION ALL SELECT 'tasks.due_date',due_date FROM public.tasks
 UNION ALL SELECT 'events.created_at',created_at FROM public.events
 UNION ALL SELECT 'events.updated_at',updated_at FROM public.events
 UNION ALL SELECT 'events.start_at',start_at FROM public.events
 UNION ALL SELECT 'events.end_at',end_at FROM public.events
)
SELECT field_name,pg_catalog.count(*) AS visible_rows,
       pg_catalog.count(*) FILTER (WHERE value IS NULL) AS null_values,
       pg_catalog.count(*) FILTER (WHERE NOT pg_catalog.isfinite(value)) AS nonfinite_values
FROM times GROUP BY field_name ORDER BY 1;

SELECT pg_catalog.count(*) FILTER (WHERE pg_catalog.isfinite(start_at) AND start_at<pg_catalog.statement_timestamp()) AS past_events,
       pg_catalog.count(*) FILTER (WHERE end_at<start_at) AS invalid_end_before_start
FROM public.events;

-- C4: Migration 9 URL inventory without calling its possibly absent function.
-- DNS/canonical IPv4/port/control checks reproduce its non-IPv6 contract.
-- Bracketed IPv6 syntax candidates are deliberately UNRESOLVED, not accepted:
-- no potentially failing inet cast and no claim of exact IPv6 validation.
-- Any unresolved count requires a separately reviewed read-only follow-up.
WITH parsed AS (
 SELECT l.url,l.is_public,b.is_public AS band_public,
        pg_catalog.btrim(l.url,' ') AS value,
        pg_catalog.substring(pg_catalog.btrim(l.url,' '),'^[Hh][Tt][Tt][Pp][Ss]?://([^/?#]+)') AS authority
 FROM public.social_links l LEFT JOIN public.bands b ON b.id=l.band_id
), parts AS (
 SELECT *, pg_catalog.left(authority,1)='[' AS ipv6_candidate,
  CASE WHEN pg_catalog.left(authority,1)='[' THEN pg_catalog.substring(authority,'^\[([0-9A-Fa-f:.]+)\]')
       ELSE pg_catalog.split_part(authority,':',1) END AS raw_host,
  CASE WHEN pg_catalog.left(authority,1)='[' THEN pg_catalog.substring(authority,'\]:([0-9]+)$')
       WHEN pg_catalog.strpos(authority,':')>0 THEN pg_catalog.split_part(authority,':',2) END AS port
 FROM parsed
), hosts AS (
 SELECT *, CASE WHEN pg_catalog.right(raw_host,1)='.' AND NOT ipv6_candidate
                THEN pg_catalog.left(raw_host,pg_catalog.length(raw_host)-1) ELSE raw_host END AS host
 FROM parts
), labels AS (
 SELECT *, pg_catalog.regexp_split_to_array(host,'\.') AS labels FROM hosts
), evaluated AS (
 SELECT *, CASE
 WHEN url IS NULL OR pg_catalog.octet_length(url)>8192 OR url COLLATE "C" ~ '[[:cntrl:]]'
  OR value COLLATE "C" !~ '^[Hh][Tt][Tt][Pp][Ss]?://'
  OR pg_catalog.strpos(value,pg_catalog.chr(92))>0 OR authority IS NULL OR pg_catalog.strpos(authority,'@')>0
  THEN 'incompatible'
 WHEN ipv6_candidate AND authority COLLATE "C" !~ '^\[[0-9A-Fa-f:.]+\](:[0-9]+)?$'
  THEN 'incompatible'
 WHEN NOT ipv6_candidate AND authority COLLATE "C" !~ '^[A-Za-z0-9.-]+(:[0-9]+)?$'
  THEN 'incompatible'
 WHEN port IS NOT NULL AND CASE WHEN pg_catalog.length(port)>5 THEN true ELSE port::integer>65535 END
  THEN 'incompatible'
 WHEN ipv6_candidate THEN 'unresolved_ipv6'
 WHEN host='' OR pg_catalog.octet_length(host)>253 THEN 'incompatible'
 WHEN labels[pg_catalog.array_length(labels,1)] COLLATE "C" ~ '^[0-9]+$'
   OR labels[pg_catalog.array_length(labels,1)] COLLATE "C" ~ '^0[xX][0-9A-Fa-f]*$'
 THEN CASE WHEN pg_catalog.array_length(labels,1)<>4 OR EXISTS (
   SELECT 1 FROM pg_catalog.unnest(labels) AS octets(label)
   WHERE CASE WHEN label COLLATE "C" !~ '^(0|[1-9][0-9]{0,2})$'
              THEN true ELSE label::integer>255 END
  ) THEN 'incompatible' ELSE 'compatible_non_ipv6' END
 WHEN EXISTS (SELECT 1 FROM pg_catalog.unnest(labels) AS dns(label)
   WHERE label COLLATE "C" !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
      OR label COLLATE "C" ~ '^[Xx][Nn]--') THEN 'incompatible'
 ELSE 'compatible_non_ipv6' END AS classification
 FROM labels
)
SELECT classification,pg_catalog.count(*) AS visible_links,
       pg_catalog.count(*) FILTER (WHERE is_public) AS selected_links,
       pg_catalog.count(*) FILTER (WHERE is_public AND band_public) AS publicly_visible_before_m9
FROM evaluated GROUP BY classification ORDER BY 1;

-- C5: integrity and publication counts, never row identifiers.
SELECT pg_catalog.count(*) FILTER (WHERE is_public) AS public_bands FROM public.bands;
SELECT pg_catalog.count(*) FILTER (WHERE is_public) AS selected_links FROM public.social_links;
SELECT pg_catalog.count(*) AS bands_without_admin FROM public.bands b
WHERE NOT EXISTS (SELECT 1 FROM public.band_members m WHERE m.band_id=b.id AND m.role='admin');
SELECT pg_catalog.count(*) AS orphan_memberships FROM public.band_members m
WHERE NOT EXISTS (SELECT 1 FROM public.bands b WHERE b.id=m.band_id);
SELECT pg_catalog.count(*) AS orphan_links FROM public.social_links l
WHERE NOT EXISTS (SELECT 1 FROM public.bands b WHERE b.id=l.band_id);
SELECT pg_catalog.count(*) AS orphan_tasks FROM public.tasks t
WHERE NOT EXISTS (SELECT 1 FROM public.bands b WHERE b.id=t.band_id);
SELECT pg_catalog.count(*) AS orphan_events FROM public.events e
WHERE NOT EXISTS (SELECT 1 FROM public.bands b WHERE b.id=e.band_id);
SELECT pg_catalog.count(*) AS tasks_without_same_band_assignee FROM public.tasks t
WHERE t.assigned_to IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM public.band_members m WHERE m.band_id=t.band_id AND m.user_id=t.assigned_to);
SELECT pg_catalog.count(*) AS tasks_without_same_band_event FROM public.tasks t
WHERE t.event_id IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM public.events e WHERE e.band_id=t.band_id AND e.id=t.event_id);

ROLLBACK;
