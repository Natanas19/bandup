# External URL safety v1 - prepared, never executed

> Historical preparation report. The user subsequently reported isolated-lab
> validation of Migrations 9/10; no final execution report for the current files
> was found in the local reports reviewed. Preserve the historical results and
> failures below; do not interpret this heading as a new execution assessment.
> See [production diagnostic evidence and gates](../../docs/supabase-production-readonly.md).
> No production validation or new SQL execution occurred in this documentation stage.

## Scope and compatibility
Migration 20261027000000 follows the eight historical migrations. No existing rows are updated or deleted. CREATE OR REPLACE VIEW preserves its identity, column types/order, owner and ACLs; before/after snapshots assert those properties and source RLS/ACL/policies/guards. Catalog preconditions and a same-server canonical view comparison fail closed on drift. Strict policy deparser comparisons may also stop on harmless formatting/version differences: investigate, do not bypass them blindly.

The immutable SECURITY INVOKER validator has an empty search_path, no table queries, network access, extensions or auth dependency. PARALLEL UNSAFE is intentional because inet parsing uses an exception block. Only the new pure validator receives EXECUTE for anon/authenticated/service_role/reader; existing schema/table/view grants and policies are not widened. The trigger function has no public EXECUTE grant.

The SQL contract is a conservative subset of getSafeExternalUrl (WHATWG URL), not an identical parser. It accepts ordinary ASCII DNS names, canonical dotted IPv4, bracketed IPv6, optional numeric ports 0..65535, HTTP/HTTPS case-insensitively, paths/query/fragments and ASCII surrounding spaces. It returns boolean without rewriting stored URLs. Controls are rejected before trimming; PostgreSQL text cannot represent NUL.

Known additional SQL rejections: Unicode/IDNA and xn-- host labels, underscores and leading/trailing hyphens in DNS labels, empty internal DNS labels, shortened/octal/hex IPv4, empty ports or ports with more than five digits, backslashes (WHATWG sometimes repairs these), non-ASCII surrounding whitespace, and inputs over 8192 bytes. These are compatibility limitations, not evidence that every rejected legacy URL is malicious. Inventory affected legacy URLs privately before deployment; legitimate unsupported URLs would be omitted publicly until an explicitly approved policy/parser revision. Percent encoding in paths is not decoded; encoded controls there are data, not literal control characters. No DNS resolution, SSRF classification or redirect-destination guarantee is provided.

## Legacy rows and concurrency
Every insert is validated, including hidden rows. Every URL change and every update leaving is_public=true is validated. Unchanged unsafe legacy URLs can be hidden and hidden-row metadata can be edited. A blanket CHECK would prevent this remediation, so none is added. Existing authorization/ownership trigger remains first; the new trigger checks the final row on every UPDATE. The public view independently filters unsafe selected legacy links and preserves JSON ordering by created_at/id, keys and empty-array behavior. Publishing a band containing legacy unsafe selected rows is safe because the view omits those links; this does not automatically deselect or modify them.

Row triggers execute under normal row locking for inserts, updates, upserts and multirow writes; view filtering is independent of a prior application check. DDL has a five-second lock timeout and runs transactionally. Superusers/owners able to disable triggers, already-open snapshots and already-delivered responses are outside this boundary. Concurrent DDL/schema drift still requires an exclusive migration window and authorized deployment controls.

## Test procedure revision - not executed
The revised suites are PREPARED ONLY. The earlier corpus run passed 86 SQL cases, but the former temporary-trigger fixture failed on EXECUTE privilege. That result does not validate the rewritten tests. No SQL was executed while preparing this revision.

All suites include sql_test_capabilities.sql after BEGIN. The shared preflight accepts capabilities, not a fixed role name: a fresh session, exact approved database name, RLS-bypassing administrative harness, TEMP, explicit fixture read/write privileges, schema USAGE and ability to SET to anon/authenticated. Each source table must retain RLS; application roles must not be superusers, BYPASSRLS or effectively inherit the table owner. It does not require EXECUTE on the private trigger function or issue any role/grant changes.

The URL suite keeps the 86-case corpus and function/view catalog assertions. It then uses the REAL enabled source-table trigger, not a newly created trigger. It requires the existing pre-Migration-9 synthetic fixture band slugs, selected javascript legacy row and hidden credential legacy row. Missing fixtures or colliding test IDs abort. Do not disable triggers, recreate unsafe legacy records, or reapply the migration to make prerequisites pass.

Administrative preparation only discovers fixtures and computes expected JSON with deterministic created_at/id ordering. Helpers are temporary SECURITY INVOKER functions; application checks execute under SET LOCAL ROLE anon/authenticated with explicit actor claims. It tests real INSERT, UPDATE, valid and invalid ON CONFLICT upserts, atomic multirow rejection, legacy hide/republish/repair/metadata behavior, member/outsider RLS and full anonymous JSON responses (including known unsafe rows, safe URL preservation, [] and private-band exclusion). Expected rejections verify SQLSTATE and the URL constraint name. Positive writes check persisted values; unauthorized UPDATE must affect zero rows.

The public-profile and ownership suites retain their existing security assertions, fixed fixture collision behavior, role switches and ROLLBACK. Only their runner prerequisite is shared/capability-based; the public-profile suite still exercises authorization triggers independently of RLS in a clearly marked administrative block. Read sql_test_execution.md for exact commands and limitations.

## Remaining rehearsal requirements
No permanent privileges are needed beyond an already capable administrative runner, locally supabase_admin. Neither an application role nor the ordinary postgres role should receive trigger-function EXECUTE for the harness. All suites end with ROLLBACK and use ON_ERROR_STOP. Run in separate fresh sessions and stop on the first unexpected error. A failed noninteractive psql connection closes and rolls back; there is no automatic retry.

Compare baseline row counts/content hashes and schema owner/ACL/RLS/policies/triggers around each suite. The migration is already committed; rolling back a test cannot revert the migration. Sequences and external effects are not generally reversed. Keep the lab idle. Two-session concurrency, HTTP/PostgREST integration, full catalog comparison and production-executor portability remain separate tests. The exact-name gate does not independently prove container/cluster identity: the external identity checks remain mandatory.

References: PostgreSQL 17 CREATE VIEW, CREATE TRIGGER and ALTER TABLE documentation (stored-view function privileges, CREATE OR REPLACE preservation, trigger ordering and CHECK behavior).

## Explicit original-lab execution parameters - revised gate not executed

This suite remains scoped to bandup_url_safety_20261027a because it needs that lab's pre-Migration-9 selected/hidden unsafe URL fixtures. Pass BOTH -v bandup_expected_database=bandup_url_safety_20261027a and -v bandup_expected_system_identifier=7701212271739703337 to psql (also -d bandup_url_safety_20261027a). The common gate verifies the actual database/system identifier and fixed pair allowlist; it has no defaults. The suite separately rejects the new functional-integrity database before corpus/fixture writes. Existing capability, RLS and URL assertions are unchanged. No old lab was accessed to prepare this revision. See sql_test_execution.md for current guarded execution instructions; run only with explicit authorization for the chosen target.


## Legacy compatibility branch (prepared, not executed)

The original sequence above is historical. For the legacy public layer use only the
[explicit compatibility procedure](../../docs/publication-compatibility.md) and
[branch manifest](../compatibility-publication.manifest.json). M8 must be verified
before the bridge; original M7/M9 are excluded. The interstage gate keeps links
private until URL safety is installed. Negative suites and the full URL corpus
variants are prepared for the disposable compatibility target, not production.
Do not apply files by timestamp or use `supabase db push` on this combined directory.
