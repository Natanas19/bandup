/* eslint-disable @typescript-eslint/no-require-imports */
// Static source checks only: never import, invoke or evaluate the PowerShell/SQL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r/g, '');
const base = 'supabase/tests/';
const identity = read(base + 'compatibility_lab_identity_check.sql');
const preflight = read(base + 'compatibility_lab_identity.sql');
const bootstrap = read(base + 'compatibility_lab_bootstrap.sql');
const launcher = read(base + 'Invoke-CompatibilityLab.ps1');

test('identity pins all target dimensions and errors before releasing control', () => {
  for (const token of ["inet_server_addr()='127.0.0.1'::inet", 'inet_server_port()=5434',
    'inet_server_port()<>5433', "current_database()='bandup_publication_compat_test'",
    ":'bandup_expected_database'='bandup_publication_compat_test'",
    ":'bandup_expected_system_identifier'='7701800113631615116'",
    "system_identifier::text FROM pg_catalog.pg_control_system())='7701800113631615116'",
    "server_version_num')::integer=170011", "server_encoding')='UTF8'", 'SESSION_USER=CURRENT_USER',
    'SELECT rolsuper', 'COALESCE(', 'false) AS verified', '\\if :compat_lab_verified',
    'SELECT 1/0 AS unauthorized_synthetic_lab_target']) assert.ok(identity.includes(token), token);
  assert.doesNotMatch(identity, /\b(CREATE|ALTER|INSERT|UPDATE|DELETE|COMMIT)\b/);
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY;[\s\S]*?\\ir compatibility_lab_identity_check.sql\nROLLBACK;/);
});

test('bootstrap and existing fixture gate verify identity before any write', () => {
  assert.ok(bootstrap.indexOf('\\ir compatibility_lab_identity.sql') < bootstrap.indexOf('CREATE ROLE'));
  const gate = read(base + 'publication_compatibility_target.sql');
  assert.ok(gate.indexOf('\\ir compatibility_lab_identity_check.sql') < gate.indexOf('DO $capabilities$'));
  assert.doesNotMatch(gate, /BEGIN;|COMMIT;|ROLLBACK;/);
  assert.match(bootstrap, /BEGIN;[\s\S]*COMMIT;\s*$/);
  for (const token of ['pg_default_acl', 'pg_event_trigger', 'pg_extension', 'pg_namespace', 'pg_roles',
    'Bootstrap collision', 'bandup_public_reader', 'bandup_profile_reader']) assert.ok(bootstrap.includes(token));
});

test('minimal Auth supplies only uid/users and unprivileged application roles', () => {
  assert.deepEqual([...bootstrap.matchAll(/^CREATE ROLE (\w+)/gm)].map(m => m[1]), ['anon', 'authenticated', 'service_role']);
  assert.equal((bootstrap.match(/NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/g) || []).length, 3);
  assert.match(bootstrap, /CREATE TABLE auth.users \(id uuid PRIMARY KEY\)/);
  assert.match(bootstrap, /CREATE FUNCTION auth.uid\(\) RETURNS uuid\nLANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''/);
  assert.match(bootstrap, /request.jwt.claim.sub[\s\S]*request.jwt.claims/);
  assert.match(bootstrap, /REVOKE ALL ON auth.users FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(bootstrap, /GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role/);
  assert.match(bootstrap, /GRANT EXECUTE ON FUNCTION auth.uid\(\) TO anon,authenticated,service_role/);
  const code = bootstrap.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /CREATE EXTENSION|CREATE SCHEMA private|auth\.(jwt|role)\(|ALTER DEFAULT PRIVILEGES|supabase_migrations/);
  assert.doesNotMatch(code, /GRANT (?:SELECT|INSERT|UPDATE|DELETE).*auth.users/);
});

test('launcher has a closed artifact allowlist, no destination override, and same-session gate', () => {
  const params = launcher.slice(launcher.indexOf('param('), launcher.indexOf("$ErrorActionPreference"));
  assert.doesNotMatch(params, /\$(?:Host|Port|Database|Connection|Sql|File|User)\b/i);
  assert.match(launcher, /if \(-not \$ExecuteReviewedSql\) \{ throw/);
  assert.match(launcher, /host=\$labHost hostaddr=\$labHost port=\$labPort dbname=\$labDatabase user=postgres/);
  assert.match(launcher, /\$labPort -eq 5433/);
  assert.match(launcher, /Get-Command psql -CommandType Application/);
  assert.match(launcher, /@\('-X','-w','--dbname'/);
  assert.match(launcher, /-like 'PG\*'/);
  assert.match(launcher, /finally \{/);
  assert.ok(launcher.indexOf("'-f',$identityPath") < launcher.indexOf("'-f',$sqlPath"));
  assert.equal((launcher.match(/& \$psqlCommand.Source/g) || []).length, 1);
  assert.match(launcher, /\$wrapTransaction = \$Artifact -in @\('M1','M2','M3','M4','M5','M8'\)/);
  const manifest = JSON.parse(read('supabase/compatibility-publication.manifest.json'));
  assert.equal(manifest.automaticDbPush, false);
  const allowed = [...launcher.matchAll(/^    \w+ = '((?:tests|migrations)\/[^']+\.sql)'$/gm)].map(m => m[1]);
  assert.equal(allowed.length, 23);
  for (const name of manifest.orderedCandidates) assert.ok(allowed.includes(name));
  for (const name of manifest.excludedOriginalAlternatives) assert.ok(!allowed.includes(name));
  for (const name of allowed) {
    const sql = read('supabase/' + name);
    assert.doesNotMatch(sql, /^\s*\\(?:c(?:onnect)?|!|i\s|copy|o\s|gexec|gset\s+.*`)/mi, name);
    assert.doesNotMatch(sql, /\b(?:dblink_connect|postgres_fdw)\b/i, name);
    for (const include of sql.matchAll(/^\\ir (.+)$/gm)) {
      assert.match(include[1], /^[a-z_]+\.sql$/);
      assert.ok(fs.existsSync(path.join(root, base, include[1])));
    }
  }
});

test('future bootstrap checks exercise simulated identity and permission failures with rollback', () => {
  const sql = read(base + 'compatibility_lab_bootstrap_checks.sql');
  assert.ok(sql.indexOf('\\ir compatibility_lab_identity_check.sql') < sql.indexOf('CREATE FUNCTION'));
  for (const token of ['absent identity', 'JSON fallback', 'direct claim precedence', 'missing JSON sub',
    '22P02', '42501', 'SET LOCAL ROLE authenticated', 'SET LOCAL ROLE anon', 'SET LOCAL ROLE service_role']) assert.ok(sql.includes(token), token);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /COMMIT;/);
});
