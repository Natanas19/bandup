# Public band profiles: migration and local regression validation

> Current URL-safety test procedure: see [sql_test_execution.md](sql_test_execution.md).
> The revised suite is prepared, not executed. It now requires the approved URL
> safety database and effective harness capabilities, not the role name postgres.
> Earlier execution reports and commands below are historical, not instructions
> to access those environments or evidence that this revision passed.


## Status and scope

The seven local BandUp migrations were applied successfully to the disposable
database `bandup_validation_c7433e5285` in container
`bandup_ownership_pg_loopback_c7433e5285` (PostgreSQL 17.11).
Both SQL regression suites passed separately with exit code 0 and final ROLLBACK.
This validates the local minimal laboratory only, not Supabase production
compatibility or HTTP/PostgREST integration. No remote state was read.

Migration: `20261020000000_public_band_profiles.sql`.
Tests: `public_band_profiles.sql` (plain psql, not pgTAP).
No new extension is required by the BandUp migrations or these SQL suites.

The local application implementation now reads the public view through a
server-only Supabase client, with explicit projection and no persistent cache.
Its frontend tests use mocked data and transport, without network access.
No HTTP/PostgREST integration has been validated. The SQL files do not add
administrative UI, publish events, or expose tasks or memberships.

## Prerequisites and deployment boundaries

Use only an independently verified disposable LOCAL Supabase-compatible
database, with auth.users, auth.uid(), and the standard anon/authenticated/
service_role roles. The migration executor needs permission to create a role,
grant the new role temporarily to itself, transfer view ownership, and create
columns, functions, triggers, policies and a view. The tests start as postgres.

Review and apply the five existing migrations first, followed by
`20261017180000_record_ownership_guards.sql`, then the new migration, ONLY
after separate authorization. The ownership SQL migration and regression script
remain unchanged. The older public_read_layer migration referenced as historical
context in the ownership documentation is absent from this worktree and is not a
prerequisite or something this migration applies, replaces or supersedes remotely.

Stop if a previous public layer, publication column, reader role, view, function,
policy or trigger already exists. Inspect it separately; do not hide collisions
with IF NOT EXISTS, CREATE OR REPLACE, DROP, or an automated rename.
The preflight also requires enabled ownership guards, source-table RLS and no
effective anon SELECT grants on any of the five internal tables.

All new migration objects are installed in one transaction. A collision or
failed postcondition must roll the whole transaction back. Run any future
application with ON_ERROR_STOP; do not continue after a migration error.
Do not apply this file to production as part of merely validating the frontend.

## Recorded local laboratory validation

The disposable database was created from template0 with owner postgres.
The bootstrap created only the following application-authentication objects,
all owned by postgres:

- Schema `auth`.
- Table `auth.users (id uuid PRIMARY KEY)`, without production auth columns,
  auth triggers, identities, sessions, or user records.
- Function `auth.uid()`, returning uuid, SQL STABLE SECURITY INVOKER, with
  empty search_path. It uses the first nonempty `request.jwt.claim.sub`, falling
  back to the `sub` field of `request.jwt.claims` JSON; absent identity returns NULL.
- PUBLIC privileges were revoked on the schema, table, and function.
  Existing roles anon, authenticated, and service_role received only schema USAGE
  and function EXECUTE, without table or column privileges on auth.users.
  Role attributes and memberships were not changed by the bootstrap.

Applied order:
1. `20261001000000_initial_bandup_schema.sql`
2. `20261002160000_tasks_delete_admins_only.sql`
3. `20261002170000_events_delete_admins_only.sql`
4. `20261002190800_events_custom_event_type.sql`
5. `20261002200000_tasks_optional_event_link.sql`
6. `20261017180000_record_ownership_guards.sql`
7. `20261020000000_public_band_profiles.sql`

The first five used ON_ERROR_STOP=1 and --single-transaction; the last two
used ON_ERROR_STOP=1 and their own BEGIN/COMMIT. Each application returned 0.
Then `record_ownership_guards.sql` and `public_band_profiles.sql` were run in
separate psql sessions, each with ON_ERROR_STOP=1 and its own BEGIN/ROLLBACK.
Both returned 0 and printed final ROLLBACK. Post-run SELECT counts confirmed
zero rows in auth.users, bands, band_members, events, tasks, and social_links.
The migrations and global reader role remain installed; test rollback did not
remove them. No cleanup or remote deployment is implied by these results.

The bootstrap deliberately adapts ownership to postgres. It does not reproduce
production auth structure, owners, ACLs, default privileges, event triggers, or
all extensions. Database tests do not establish HTTP authentication, PostgREST
schema exposure, frontend hydration, Safari behavior, or HTML/RSC/CDN cache
invalidation. Those require separate review and authorization.

## Publication model

- bands.is_public and social_links.is_public are NOT NULL DEFAULT false.
  Existing records remain unpublished. Omitting the value on INSERT uses false.
- A band cannot be INSERTed with true, including the INSERT candidate of an
  upsert. Create it privately, let the existing creator-as-admin trigger run,
  then publish with an authorized UPDATE. Explicit NULL is rejected by NOT NULL.
- Changes to a band's publication require auth.uid() and admin membership in
  the original band. Existing admin-only UPDATE RLS remains in force.
- A public link INSERT, or a change of link publication, requires an admin of
  that band. Existing RLS still controls private link INSERT/UPDATE/DELETE too.
- A link's band_id cannot be updated, even by an admin of both bands.
  Recreate it in the intended band; omitted publication starts false.
- Unchanged publication assignments remain allowed when existing RLS allows
  the rest of the operation. Triggers inspect every INSERT/UPDATE row.
- Unpublishing a band hides all links but retains their individual selections.
  Explicit republication restores only selected links. This needs clear UI copy.
- These controls do not defend against a DBA who can disable/drop triggers.

New trigger functions are SECURITY INVOKER with empty search_path. They reuse
the existing admin helper, do not replace it, and receive no direct application
EXECUTE grants. Runtime trigger behavior passed in the recorded local suite;
it must still be validated for any different target environment.

## Public read boundary

The new NOLOGIN/NOINHERIT/NOBYPASSRLS role bandup_public_reader owns only the
view, not the source tables. It has column SELECT grants only on bands and
social_links, and SELECT policies limited to the two publication flags.

The migration grants temporary membership and schema CREATE for ownership
transfer, then revokes the explicit setup grants. Local verification found a
separate administrative membership still present: role bandup_public_reader,
member postgres, grantor supabase_admin, ADMIN=true, INHERIT=false, SET=false.
This is the administrative grant associated with role creation by CREATEROLE
on PostgreSQL 17; do not claim all memberships were removed. It does not allow
inheriting reader privileges or SET ROLE through that grant, but ADMIN OPTION
allows administering membership. No additional revocation was performed.
The role itself remains NOLOGIN/NOINHERIT/NOBYPASSRLS and has no schema CREATE.
A postcondition rejects effective CREATE via inherited/PUBLIC privileges or
application membership in the reader role. The suites check application roles,
not absence of this administrative postgres membership. Existing privileges
of application roles on source tables are not rewritten. Because the reader role
is cluster-global, review its grants/dependencies before any future cleanup or
deployment; do not assume dropping the disposable database also drops the role.

public.public_band_profiles deliberately uses owner-context evaluation
(security_invoker=false) and security_barrier=true. Its owner remains subject
to source RLS and is neither a superuser nor a table owner. A security-invoker
view would require granting visitors source-table access, which is not this
design. Security barrier alone would not secure an overprivileged view owner.

Output columns, explicitly enumerated:
name, slug, description, logo_url, links.

Each link contains only platform and url. Internal IDs and timestamps may be
used to join/order rows but are not returned. No SELECT * and no joins to
events, tasks or band_members exist in the view. NULL profile description/
image are preserved and a profile with no selected links returns [].

Only SELECT on the new view is granted to anon and authenticated. Possible
default grants on this NEW view and new functions are explicitly removed
before the intended grants. No anon source-table grant or source-table anon
policy is added. Direct writes to the view are not granted.

The view allows listing published profiles: slug filtering is not an
anti-enumeration mechanism. An RPC-only interface would be a separate design.
Names/descriptions/images are public once opted in; preview and consent are
needed. URLs are not sanitized by this SQL: the application must continue to
validate protocols, credentials, labels and platform values on read/write.

## SQL regression coverage validated locally

The regression script has ON_ERROR_STOP and runs fixtures/helpers/claims inside
one transaction ending in ROLLBACK. IDs and slugs are fictitious and collision
errors are intentional. Never change the script to reuse existing user data.
A failed noninteractive psql session rolls back when the connection closes.
An interactive failed transaction must be rolled back explicitly.

Before any future run, independently confirm the destination host is loopback,
the exact port/database belong to a disposable instance, and the role is
postgres. Supply host, port, database and user explicitly; do not rely on
PGHOST/PGDATABASE defaults or a project-linked remote connection. No test
runner, migration application or database connection is launched by preparing
these files.

The locally executed assertions cover:
- Exact view fields, defaults, role attributes, owner and privilege boundaries.
- No published fixtures before opt-in, and rejection of public band INSERT/NULL.
- Admin publication, ordinary-member/outsider/other-band-admin denial.
- Trigger checks independently of RLS using the privileged local harness.
- Public and private links in one band, selected links in an unpublished band,
  and a published empty profile.
- Anonymous SELECT on the view, denial on all five internal tables and view
  writes, signed-in outsider access only to the public projection.
- No private fixture content, member IDs, record IDs, tasks or events in output.
- Immutable link band_id, atomic rejection of mixed changes and upsert transfer.
- Legitimate link upsert, explicit band republication by conflict UPDATE,
  link withdrawal and rejection of NULL publication values.
- Band withdrawal/republication and retention of explicit link selection.
- Existing event/member ownership guards, ordinary-member task/event edits,
  admin-only deletions, last-admin protection, assignment/event cleanup and
  band-deletion cascades.

Expected SQL errors must match SQLSTATE and, for new guards, constraint markers.
RLS-hidden UPDATE/DELETE must affect exactly zero rows. Successful writes are
checked through resulting state, not merely command completion.

Run the existing ownership regression script separately in a fresh approved
test session. Do not include it inside this suite: its BEGIN/ROLLBACK would
interfere with the outer transaction. Its public_events acceptance assumptions
are not claims about this profile-only MVP.

## Acceptance still required before release

None of the following has been executed:
1. Upgrade/backfill test: in a disposable database stopped before the new
   migration, create old-schema bands/links, snapshot records/object definitions,
   apply the new migration, then verify every old flag is false and all other
   values, old functions, triggers, policies and grants remain unchanged.
   Post-migration fixture tests alone do not prove this upgrade case.
2. Collision tests: precreate each conflicting object (including overloads or
   columns), apply the migration in a separate disposable setup and verify no
   partial installation. Reapplication must fail without changing objects.
3. Cross-session tests: withdraw publication, COMMIT, then read from a separate
   anon session; new statements started after the commit must return no profile.
   Current script assertions use fresh statements inside one transaction.
4. Concurrency regression: demote/delete last admins and change publication
   concurrently; confirm the existing invariants and authorization semantics.
5. Application tests: no-session and signed-in HTTP access, identical private/
   missing-slug behavior, input validation, image fallback and error handling.
6. Cache: use uncached server reads/dynamic rendering initially; verify HTML,
   RSC, CDN and metadata behavior after withdrawal. This SQL cannot clear a
   page already opened, copies made by visitors, or public image caches.
7. Deployment review: inspect actual remote schema, ACLs, default privileges,
   role-creation support and existing public objects ONLY with new authorization.

No automatic reversal is provided. Any reversal requires a separately reviewed
compensatory migration, dependency checks and an explicit decision about the
new publication data. Do not modify historical migrations or use DROP CASCADE.
