# Record ownership guards: validation and reversal

> Current URL-safety test procedure: see [sql_test_execution.md](sql_test_execution.md).
> The revised suite is prepared, not executed. It now requires the approved URL
> safety database and effective harness capabilities, not the role name postgres.
> Earlier execution reports and commands below are historical, not instructions
> to access those environments or evidence that this revision passed.


## Scope

Migration: `20261017180000_record_ownership_guards.sql`.

Adds only two functions and two BEFORE UPDATE ROW triggers. Existing functions,
triggers, RLS, grants, views and records are not replaced or modified. The guards
reject ownership changes even for band administrators; unchanged values pass.
`band_members.user_id` remains protected by the existing trigger.

Both functions use SECURITY INVOKER and an empty search_path, read only OLD/NEW,
and have no EXECUTE grants to PUBLIC, anon, authenticated or service_role. The
migration owner retains the privileges needed to create the triggers. Trigger
execution as authenticated passed in the local regression suite; other target
environments still require separate validation.

Alphabetical order for the known BEFORE UPDATE ROW triggers:

1. `band_members_guard_band_id`, then `band_members_prevent_last_admin_removal`.
2. `events_guard_ownership`, then `events_set_updated_at`.

Future triggers that rewrite protected fields require an order review. These
guards run on every UPDATE rather than only an UPDATE OF column list. They do
not intercept INSERT/DELETE or grant new access. No-op ownership assignments
still allow normal updated_at behavior. They do not prevent authorized removal
and recreation of memberships through existing INSERT/DELETE policies.

## Execution status and prerequisites

All seven local BandUp migrations were applied successfully in chronological
order to disposable database `bandup_validation_c7433e5285`, owned by postgres,
in container `bandup_ownership_pg_loopback_c7433e5285` (PostgreSQL 17.11).
Both `record_ownership_guards.sql` and `public_band_profiles.sql` passed in
separate sessions with ON_ERROR_STOP=1, exit code 0, and final ROLLBACK.
Subsequent SELECT counts confirmed zero rows in auth.users and all five BandUp
tables. No fixture data remained. The migrations and reader role remain installed.

The database was created from template0. Its minimal bootstrap supplied schema
auth, `auth.users(id uuid PRIMARY KEY)`, and SQL STABLE SECURITY INVOKER
`auth.uid()` with empty search_path, all owned by postgres. The function reads
the nonempty request.jwt.claim.sub or falls back to request.jwt.claims JSON sub,
returning NULL without identity. PUBLIC grants were revoked; anon, authenticated,
and service_role received only schema USAGE and function EXECUTE, with no direct
auth.users access. The bootstrap did not alter global roles or their memberships.
See [the public-profile validation record](public_band_profiles.md#recorded-local-laboratory-validation)
for the complete migration order and laboratory boundaries.

After migration seven, bandup_public_reader retained an administrative grant
to postgres from supabase_admin: ADMIN=true, INHERIT=false, SET=false.
The explicit temporary grant was revoked, but this automatic administrative
grant remains. It does not confer inherited reader privileges or SET ROLE,
but does permit membership administration. It was not removed and did not
prevent either suite from passing. The role is cluster-global; dropping the
disposable database alone will not remove it.

These results do not prove compatibility with Supabase production owners,
permissions, default ACLs, full auth schema, or HTTP/PostgREST integration.
No remote environment was accessed. Static review alone remains insufficient.
Do not execute this test file or its fixtures in production, even though it
ends in ROLLBACK.

Use a disposable local Supabase-compatible database with auth.users, auth.uid(),
the standard roles, and the five existing local migrations followed by the new
migration. The test runner must start as postgres, then the script switches to
authenticated and supplies fictitious request claims. It requires no extensions.
The SQL script is a plain psql regression script, not a pgTAP test.

Example, only after independently confirming the database is disposable/local:

```sh
psql -v ON_ERROR_STOP=1 -d bandup_security_test -f supabase/tests/record_ownership_guards.sql
```

All fixtures/helpers are inside a transaction that ends in ROLLBACK. A failed
psql process with ON_ERROR_STOP closes its connection and rolls back. In an
interactive session, explicitly roll back after a failure. Fixed fictitious IDs
and slugs intentionally cause a collision error instead of reusing records.
No passwords, access tokens, keys or actual user data are needed.

## Automated cases validated locally

- Creator edits an event, including unchanged protected values.
- Creator and admin each try changing event band, creator, or both.
- Admin legitimately edits events in bulk; mixed forbidden batch is atomic.
- Event upsert exercises insert and legitimate update paths; forbidden band and
  creator updates must return the new guard's exact SQLSTATE/constraint marker.
- Membership promotion/demotion while another admin remains, and unchanged band.
- Membership band changes, mixed batch changes and transfer by upsert fail.
- Membership role update by upsert succeeds.
- Existing user_id guard and last-admin update/delete guard continue rejecting.
- Failed membership transfer retains assigned tasks; legitimate removal clears
  assignments. Band deletion remains possible through existing cascades.

Rejection helpers require an exception; zero affected rows cannot masquerade as
a successful guard test. Successful cases assert persisted state under RLS.
Exceptions run in PL/pgSQL subtransactions so expected failures do not abort the
whole suite. These helpers exist only in pg_temp and disappear at rollback.

## Additional acceptance tests before publication

The historical `20261004120000_public_read_layer` proposal is absent from this
worktree and is not a prerequisite for either locally executed suite. No file
was copied from another worktree. The current profile-only public projection
is supplied by `20261020000000_public_band_profiles.sql` and tested separately
by `public_band_profiles.sql`; it does not publish events.
The checks below remain additional acceptance scenarios. Public-event scenarios
apply only if a separately reviewed public-event layer is introduced, and must
not be interpreted as behavior of the current profile-only MVP. Use a disposable
environment matching the intended target and obtain separate authorization.

1. Capture hashes/configuration/ACLs of existing private functions and definitions
   of existing triggers, policies and public views before/after migration; all
   must remain unchanged. Confirm both new triggers are enabled (O), correctly
   ordered, and both functions are invoker with empty search_path and minimal ACLs.
2. As anon, read a future event in a public fixture band and confirm private-band
   events remain absent. Attempt private-to-public transfer as creator/admin;
   reject it and confirm no new public row appears. Legitimate edits to already
   public events remain visible. Existing time filtering remains unchanged.
3. Associate a task to an event; transfers must fail with the guard marker, not
   merely because of the FK. Normal edits and authorized event deletion must
   preserve the existing task-event SET NULL behavior.
4. A non-creator member and a nonmember must not gain edit access; verify affected
   rows and final state rather than only HTTP success. Test unauthenticated writes.
5. Test concurrent attempts to remove/demote the last admins using two sessions;
   the existing serialized protection must leave at least one admin.
6. For both tables, test mixed insert/update upsert batches containing a prohibited
   change; the entire statement must roll back. Also test membership insert by
   upsert and unchanged protected fields in the conflict update path.
7. Test protected NULL values (guard rejection), unchanged bulk ownership values,
   simultaneous membership band/user changes, and attempts by a privileged role
   with RLS bypass: enabled triggers must still enforce their invariants.
8. Reapply the migration in the disposable database; it must fail on collisions
   and leave existing objects intact. Separately precreate each conflicting
   function/trigger name (including a function overload) before applying it;
   the transaction must prevent partial installation. Do not replace objects.
9. Exercise compensatory reversal in the disposable database, compare old object
   definitions again, and confirm only the four added objects disappear.

## Compensatory migration (proposal only; not automatically applied)

Create a NEW versioned migration after this one, with the following content.
Check dependencies and object definitions first. Do not use IF EXISTS or CASCADE:
unexpected absence/dependencies must stop the rollback for review.

```sql
BEGIN;

DROP TRIGGER events_guard_ownership ON public.events;
DROP TRIGGER band_members_guard_band_id ON public.band_members;

DROP FUNCTION private.guard_event_ownership();
DROP FUNCTION private.guard_band_member_band();

COMMIT;
```

Reversal does not edit data or touch existing protections, but it reopens the
previous ownership/transfer permissions and therefore needs explicit approval.
Do not delete or edit the original migration to reverse an applied deployment.
