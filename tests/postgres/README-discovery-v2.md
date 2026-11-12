# Discovery v2: isolated PostgreSQL verification

Local candidate: `supabase/migrations/20261112120000_band_discovery_logos_v2.sql`.
Never apply automatically. Its public image origin is fixed to Demo, matching the
reviewed band-logo association RPC. Other origins and legacy paths return NULL.
No `is_public` column is required. All bands remain discoverable by authenticated
users; the returned summary is empty. The original discovery RPC is not replaced.

Manual runner (not discovered by `node --test`):

```powershell
$env:BANDUP_DISCOVERY_LOCAL_TESTS = 'create-isolated-cluster'
node tests/postgres/discovery-v2-isolated.cjs --execute
```

Requires PostgreSQL 17 binaries in `C:/Program Files/PostgreSQL/17/bin`.
Creates a fresh cluster/database under TEMP, bound to 127.0.0.1 on a random port
other than 5433. No remote URL, .env, existing cluster, Auth service or Storage
service is used. PG environment variables are cleared. Every SQL connection
checks database, port, server address, PostgreSQL version, physical data directory
and administrative identity before submitting fixture/migration/test SQL.
The synthetic table has no is_public column. Its RLS denies direct authenticated
reads; the definer RPC must still discover all 65 synthetic bands.

Verifies integral installation and rollback on unexpected default ACLs, collisions,
19 valid/invalid URL cases (including foreign origin/bucket/band and URL suffixes),
Auth identity and role, API EXECUTE grants, limits/defaults, exclusive UUID cursor,
ordering, no missing/duplicate results, four-field projection, empty summary, and
unchanged original function definition and metadata. Fixtures simulate Auth via
transaction-local claims; they do not validate real JWTs or image delivery.

The runner stops the new server and retains its database/logs/result.json; it never
deletes test clusters. Windows sandbox token restrictions can require approval to
run this same isolated runner outside the sandbox.

Before any future remote application: confirm the actual old RPC definition,
all-band scope and metadata in the intended project, absence of v2 collisions,
effective privileges, backup/recovery and explicit application authorization.
Before deploying this frontend, install/validate v2 separately; otherwise missing
v2 is reported as unavailable by the existing service error handling. No fallback
to direct bands reads or individual photo queries is introduced.
