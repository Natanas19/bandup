-- Local disposable functional test. Run through musician-availability-rls.cjs.
-- UUID placeholders are replaced only with fresh crypto.randomUUID() values.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';
SET LOCAL bandup.test_user_a = '__USER_A__';
SET LOCAL bandup.test_user_b = '__USER_B__';

INSERT INTO auth.users(id) VALUES
  (current_setting('bandup.test_user_a')::uuid),
  (current_setting('bandup.test_user_b')::uuid);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('bandup.test_user_b'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object(
         'sub', current_setting('bandup.test_user_b'), 'role', 'authenticated')::text, true);
DO $test$
BEGIN
  IF current_user <> 'authenticated'
    OR auth.uid() IS DISTINCT FROM current_setting('bandup.test_user_b')::uuid
    OR NOT pg_catalog.row_security_active('public.musician_availability') THEN
    RAISE EXCEPTION 'Authenticated RLS context required';
  END IF;
END $test$;
INSERT INTO public.musician_availability(user_id)
VALUES (current_setting('bandup.test_user_b')::uuid);
UPDATE public.musician_availability SET available = true
WHERE user_id = current_setting('bandup.test_user_b')::uuid;

SELECT set_config('request.jwt.claim.sub', current_setting('bandup.test_user_a'), true),
       set_config('request.jwt.claims', json_build_object(
         'sub', current_setting('bandup.test_user_a'), 'role', 'authenticated')::text, true);
INSERT INTO public.musician_availability(user_id)
VALUES (current_setting('bandup.test_user_a')::uuid);
DO $test$
BEGIN
  IF auth.uid() IS DISTINCT FROM current_setting('bandup.test_user_a')::uuid
    OR NOT pg_catalog.row_security_active('public.musician_availability') THEN
    RAISE EXCEPTION 'User A RLS context required';
  END IF;
  IF (SELECT count(*) FROM public.musician_availability) <> 1
    OR (SELECT available FROM public.musician_availability
        WHERE user_id = current_setting('bandup.test_user_a')::uuid) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Own row must start false and be readable';
  END IF;
END $test$;
SELECT 'PASS:default_false';

DO $test$
DECLARE affected bigint;
BEGIN
  UPDATE public.musician_availability SET available = true
  WHERE user_id = current_setting('bandup.test_user_a')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 OR (SELECT available FROM public.musician_availability
      WHERE user_id = current_setting('bandup.test_user_a')::uuid) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Own availability update/read failed';
  END IF;
END $test$;
SELECT 'PASS:own_read_update';

DO $test$
DECLARE affected bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM public.musician_availability
    WHERE user_id = current_setting('bandup.test_user_b')::uuid) THEN
    RAISE EXCEPTION 'Another user row was visible';
  END IF;
  UPDATE public.musician_availability SET available = false
  WHERE user_id = current_setting('bandup.test_user_b')::uuid;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Another user row was updated'; END IF;
  BEGIN
    INSERT INTO public.musician_availability(user_id, available)
    VALUES (current_setting('bandup.test_user_b')::uuid, false);
    RAISE EXCEPTION 'Cross-user insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $test$;
SELECT 'PASS:cross_user_denied';

DO $test$
BEGIN
  -- A no-op identity assignment passes the own-row predicate, but must still
  -- fail the column ACL. This distinguishes column protection from RLS alone.
  BEGIN
    UPDATE public.musician_availability SET user_id = user_id
    WHERE user_id = current_setting('bandup.test_user_a')::uuid;
    RAISE EXCEPTION 'Identity column update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.musician_availability
    SET user_id = current_setting('bandup.test_user_b')::uuid
    WHERE user_id = current_setting('bandup.test_user_a')::uuid;
    RAISE EXCEPTION 'Identity replacement unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $test$;
SELECT 'PASS:identity_update_denied';

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', 'anon', true),
       set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $test$
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'Anonymous context required';
  END IF;
  BEGIN
    PERFORM available FROM public.musician_availability;
    RAISE EXCEPTION 'Anonymous SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.musician_availability(user_id)
    VALUES (current_setting('bandup.test_user_a')::uuid);
    RAISE EXCEPTION 'Anonymous INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.musician_availability SET available = false;
    RAISE EXCEPTION 'Anonymous UPDATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.musician_availability;
    RAISE EXCEPTION 'Anonymous DELETE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $test$;
SELECT 'PASS:anon_denied';

RESET ROLE;
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.musician_availability WHERE user_id IN (
    current_setting('bandup.test_user_a')::uuid,
    current_setting('bandup.test_user_b')::uuid)) <> 2
    OR (SELECT available FROM public.musician_availability
        WHERE user_id = current_setting('bandup.test_user_b')::uuid) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Owner check found cross-user changes';
  END IF;
END $test$;
ROLLBACK;

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN ('__USER_A__'::uuid, '__USER_B__'::uuid))
    OR EXISTS (SELECT 1 FROM public.musician_availability
      WHERE user_id IN ('__USER_A__'::uuid, '__USER_B__'::uuid)) THEN
    RAISE EXCEPTION 'Rollback did not remove test fixtures';
  END IF;
END $test$;
SELECT 'PASS:rollback';
