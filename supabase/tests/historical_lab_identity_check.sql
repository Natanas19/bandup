-- FUTURE INDEPENDENT CLUSTER ONLY. Intentionally unbound and fail-closed.
-- No approved host/port/database/system identifier exists for this scenario yet.
-- A separate identity review must replace this refusal with exact pinned checks
-- for loopback, a NEW cluster, PostgreSQL 17.11 UTF8 and a fresh admin session.
-- Never accept 5433, 5434 or system identifier 7701800113631615116.
-- Do not remove this gate or substitute the existing compatibility lab gate.
\set ON_ERROR_STOP on
DO $identity_unbound$
BEGIN
  RAISE EXCEPTION 'Historical laboratory identity not reviewed; execution disabled';
END;
$identity_unbound$;
