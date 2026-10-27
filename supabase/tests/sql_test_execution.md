# SQL test targeting - prepared identity revision, NOT EXECUTED

Only test SQL and documentation changed in this revision. No database, container, role, fixture, migration or SQL suite was accessed/executed. Earlier successful Migration 9 runs are historical evidence for the old gate, not proof that this revised psql gate has run.

## Explicit targets: no defaults and no arbitrary database

Every invocation must provide BOTH psql variables:

- -v bandup_expected_database=<exact approved name>
- -v bandup_expected_system_identifier=<exact approved cluster identifier>

The shared sql_test_capabilities.sql checks variable presence, current_database(), pg_control_system().system_identifier and this fixed pair allowlist:

| Database | PostgreSQL system identifier | Loopback port | Container |
| --- | --- | --- | --- |
| bandup_url_safety_20261027a | 7701212271739703337 | 55432 | bandup-url-safety-20261027a |
| bandup_functional_integrity_20261027b | 7701232072543551523 | 55442 | bandup-functional-integrity-20261027b |

Names/identifiers cannot be mixed between rows. No fallback reads the expected identity from the live database. Missing/blank/wrong variables, a mismatching connection or an unlisted pair stop before test writes. Quoted psql literals (:'variable') expand outside dollar-quoted DO bodies, avoiding both lack of expansion and raw SQL interpolation. The allowlist is not permission to execute against a target without explicit user authorization for that run.

The include forces ON_ERROR_STOP. It uses read-only SELECTs and psql conditionals; failure branches echo the reason then deliberately SELECT 1/0, yielding a nonzero SQL error (22012) rather than a potentially successful plain quit. An unavailable pg_control_system privilege also fails closed; do not grant privileges to bypass it. Use an already capable local administrative runner. Each caller begins a transaction before including the preflight. A failed noninteractive psql connection closes and rolls back any uncommitted work. There is no automatic retry.

Capabilities remain unchanged after identity verification: a fresh SESSION_USER=CURRENT_USER administrative session, RLS bypass, TEMP, auth/public/private schema USAGE, source-table CRUD, auth.users SELECT/INSERT and SET to anon/authenticated. Application roles must not be superusers, BYPASSRLS or effectively inherit source owners. The tests never expand permanent grants. Helpers remain temporary SECURITY INVOKER functions; real application checks use SET LOCAL ROLE with explicit actor claims, then RESET ROLE.

## Per-suite scope

- functional_integrity_legacy_fixture.sql and functional_integrity.sql additionally require the NEW functional-integrity database. Even passing the old approved identity does not permit these files there.
- external_link_url_safety.sql additionally requires the OLD URL database and its pre-Migration-9 selected/hidden unsafe URL fixtures. Do not run it in the new empty cluster, copy its fixtures, disable triggers or reapply Migration 9 to make it pass.
- public_band_profiles.sql and record_ownership_guards.sql support either explicit approved pair, subject to fresh authorization, unchanged fixtures/collision checks and installed migrations. Their existing security assertions are retained.

The NEW cluster already has migrations 1..9. Do not reapply them. Migration 10 and its fixture remain unexecuted. This SQL-only laboratory has no Auth/PostgREST HTTP stack.

## Mandatory external identity check

The SQL pair gate does not replace verification of the container and exclusive volume/network. Before every future action, inspect ONLY the authorized target and require:

- NEW directory D:\Projetos\bandup-functional-integrity-lab-20261027b
- container ID c47883c88e7a4789e6fa0bf04498853527472ceee67512deb62ac65359d8b205
- sole volume bandup-functional-integrity-20261027b mounted at /var/lib/postgresql/data
- sole network bandup-functional-integrity-20261027b containing only that container
- binding 127.0.0.1:55442 -> 5432/tcp
- image sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53
- local Docker Engine npipe:////./pipe/dockerDesktopLinuxEngine

For a separately authorized OLD run, require container ID 22d884224e4c85cd577b74d6952265603c80ee6c49793eac53149bba81dadeb5, its own volume bandup-url-safety-20261027a, port 55432 and known two dedicated networks. Never access the manual laboratory. A copied cluster can retain a system identifier, so container/volume inspection remains essential.

## Future commands - do NOT execute in this preparation stage

Run from D:\Projetos\bandup-dev only after explicit authorization. The following Python runner is a documentation example, not a created/executed script. It reads files without modifying them and expands the one reviewed relative include in memory, preserving all psql identity commands. It needs no docker cp, mounts or container file/config changes. It uses UTF-8 bytes explicitly and starts a fresh psql -X session as existing local supabase_admin for each call.

```python
import json, os, pathlib, subprocess
project = pathlib.Path(r'D:\Projetos\bandup-dev')
docker = pathlib.Path(os.environ['LOCALAPPDATA']) / 'Programs/DockerDesktop/resources/bin/docker.exe'
base = [str(docker), '--host', 'npipe:////./pipe/dockerDesktopLinuxEngine']
container = 'bandup-functional-integrity-20261027b'
database = 'bandup_functional_integrity_20261027b'
cluster = '7701232072543551523'

def verify_container():
    c = json.loads(subprocess.check_output(base + ['inspect', container]))[0]
    assert c['Id'] == 'c47883c88e7a4789e6fa0bf04498853527472ceee67512deb62ac65359d8b205'
    assert c['Image'] == 'sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53'
    assert c['Config']['Labels']['bandup.lab'] == 'functional-integrity-20261027b'
    assert len(c['Mounts']) == 1 and c['Mounts'][0]['Name'] == container
    assert c['Mounts'][0]['Destination'] == '/var/lib/postgresql/data'
    assert c['NetworkSettings']['Ports']['5432/tcp'] == [{'HostIp': '127.0.0.1', 'HostPort': '55442'}]
    assert set(c['NetworkSettings']['Networks']) == {container}
    network = json.loads(subprocess.check_output(base + ['network', 'inspect', container]))[0]
    assert set(network['Containers']) == {c['Id']}

shared = (project / 'supabase/tests/sql_test_capabilities.sql').read_text(encoding='utf-8')

def run_payload(payload):
    verify_container()
    command = base + ['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin',
        '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
        '-v', 'bandup_expected_database=' + database,
        '-v', 'bandup_expected_system_identifier=' + cluster, '-f', '-']
    result = subprocess.run(command, input=payload.encode('utf-8'), capture_output=True)
    print(result.stdout.decode('utf-8', errors='replace'))
    print(result.stderr.decode('utf-8', errors='replace'))
    if result.returncode:
        raise SystemExit('STOP: SQL failed; do not correct or repeat automatically')

def run_suite(relative):
    assert relative in {
        'supabase/tests/functional_integrity_legacy_fixture.sql',
        'supabase/tests/functional_integrity.sql',
        'supabase/tests/public_band_profiles.sql',
        'supabase/tests/record_ownership_guards.sql',
    }
    source = (project / relative).read_text(encoding='utf-8')
    marker = r'\ir sql_test_capabilities.sql'
    assert source.count(marker) == 1
    run_payload(source.replace(marker, shared))
```

Future preflight-only invocation (no fixtures/data writes):

```python
run_payload('BEGIN READ ONLY;\n' + shared + '\nROLLBACK;\n')
```

If SQL files/include are already available in the verified container, equivalent psql arguments for one future suite are:

```text
psql -X -U supabase_admin -d bandup_functional_integrity_20261027b -v ON_ERROR_STOP=1 -v bandup_expected_database=bandup_functional_integrity_20261027b -v bandup_expected_system_identifier=7701232072543551523 -f <reviewed-suite.sql>
```

For a separately authorized Migration 9 run in its original container, use BOTH old values: -d bandup_url_safety_20261027a -v bandup_expected_database=bandup_url_safety_20261027a -v bandup_expected_system_identifier=7701212271739703337. File/include must be adjacent when using -f; otherwise use the exact include expansion above. Do not change only -d or infer expected values from a live connection.

## Stage sequence and baseline comparisons

1. Verify external identity, then run the shared preflight in BEGIN READ ONLY/ROLLBACK. Compare the six table counts/hashes and original catalog with the NEW lab's baseline.jsonl/baseline-readonly.sql. Expected initial user data: all zero; migrations exactly 1..9, 11 user triggers, no functional guard. Baseline snapshot execution also requires the external and SQL identity gates. Keep the initial baseline immutable.
2. With separate fixture authorization, invoke ONLY run_suite('supabase/tests/functional_integrity_legacy_fixture.sql'). It checks the new target, Migration 9 present and 10 absent, then COMMITs an additive synthetic seed. Expect 2 users, 1 band, 2 memberships (one automatic), 1 task, 1 event and 1 link. Save a distinct POST-FIXTURE baseline and original-row/catalog comparisons. Do not hide a mismatch by replacing the initial baseline. There is no cleanup or reset step.
3. With separate migration authorization, verify identity again and apply the UNCHANGED Migration 10 once. To gate the same database connection before its original SQL, the future runner may call run_payload('BEGIN READ ONLY;\n' + shared + '\nROLLBACK;\n' + migration_source), where migration_source is read verbatim from supabase/migrations/20261027010000_functional_integrity.sql after recording its SHA256. This does not strip/replace the migration's own BEGIN/COMMIT. Stop on any error. A successful migration commits, so rollback of later suites cannot undo it.
4. Compare full row hashes to the POST-FIXTURE baseline. View identity/owner/types/options/ACL, source columns/ACL/RLS/policies/constraints and old guards/functions must remain intact. Expected additions only: five functional triggers and one new private function (16 user source triggers total). Record a separate POST-MIGRATION catalog baseline.
5. With test authorization, invoke functional_integrity.sql, then public_band_profiles.sql, then record_ownership_guards.sql in separate fresh sessions. Pause after EACH to compare all six row hashes/counts and the complete POST-MIGRATION catalog baseline. All suites ROLLBACK. Stop immediately on a failure; no subsequent suite, retry, cleanup, permission widening or migration reapplication. Do not run the old external URL suite on this new target.
6. Explicitly authorized two-session concurrency/lock waits, statement-time boundary and HTTP/PostgREST tests remain separate work. Transactions do not undo sequences or external effects; keep the laboratory idle. ON CONFLICT validates INSERT candidates before UPDATE, so unchanged legacy metadata uses UPDATE as documented.

The fixture COMMIT, migration COMMIT and suite ROLLBACK are distinct. A fixture failure should leave the initial baseline; a migration failure should leave the committed fixture baseline; a suite failure should leave the committed migration and fixture intact. Always verify this instead of assuming it. No real SQL compilation, identity mismatch exit, rollback or permission behavior of this revised gate has been tested in this preparation-only stage.
