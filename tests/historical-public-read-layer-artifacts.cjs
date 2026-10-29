/* eslint-disable @typescript-eslint/no-require-imports */
// Offline artifact builders. Import only reads local files; never executes SQL.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r/g, '');
const evidence = JSON.parse(read('supabase/tests/historical_public_read_layer.statements.json'));
const bridgePath = 'supabase/migrations/20261028000000_legacy_publication_compatibility.sql';
const gate = '\\ir historical_lab_identity_check.sql\n';
const begin = '\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL search_path = \'\';\nSET LOCAL statement_timeout = \'60s\';\nSET LOCAL lock_timeout = \'5s\';\n' + gate;

function fixture() {
  return '-- ARCHIVED STATEMENTS, not original file/provenance or production evidence.\n'
    + '-- Wrapper and preconditions below are new laboratory infrastructure.\n' + begin
    + `DO $empty$
BEGIN
  -- INHERIT for a new PG17 membership defaults to the receiving executor.
  IF SESSION_USER<>CURRENT_USER OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
      WHERE oid=CURRENT_USER::regrole::oid AND rolsuper AND rolinherit) THEN
    RAISE EXCEPTION 'Historical fixture requires fresh superuser INHERIT executor';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('bandup_public_reader','bandup_profile_reader'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('v','m'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid IN ('public.bands'::regclass,'public.social_links'::regclass)
      AND attname='is_public' AND NOT attisdropped)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclrole=CURRENT_USER::regrole::oid)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger) THEN
    RAISE EXCEPTION 'Historical fixture collision or unreviewed defaults; never repair';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
      ('public.bands'::regclass,'public.events'::regclass,'public.social_links'::regclass,
       'public.tasks'::regclass,'public.band_members'::regclass)
      AND relkind='r' AND relrowsecurity AND relowner=CURRENT_USER::regrole::oid)<>5 THEN
    RAISE EXCEPTION 'Historical fixture requires reviewed M1-M5 source baseline';
  END IF;
END;
$empty$;
-- BEGIN ARCHIVED STATEMENTS: exact decoded elements; added semicolon separators.
` + evidence.statements.map((sql, index) => `-- ARCHIVED STATEMENT ${index + 1}\n${sql};\n`).join('\n')
    + '-- END ARCHIVED STATEMENTS\nCOMMIT;\n';
}

function expectedViews() {
  const names = ['historical_expected_bands', 'historical_expected_links', 'historical_expected_events'];
  return evidence.statements.slice(11, 14).map((sql, index) => sql.replace(
    /CREATE VIEW public\.\w+/, 'CREATE TEMP VIEW ' + names[index]) + ';\n').join('\n');
}

function bootstrap() {
  const original = read('supabase/tests/compatibility_lab_bootstrap.sql');
  return '-- FUTURE INDEPENDENT HISTORICAL CLUSTER. Synthetic Auth, not original environment.\n'
    + original.replace('\\ir compatibility_lab_identity.sql\nBEGIN;', 'BEGIN;\n' + gate.trimEnd())
      .replace('DECLARE role_name text;', 'DECLARE role_name text; schema_name text;')
      .replace('    IF pg_catalog.has_any_column_privilege', `    FOREACH schema_name IN ARRAY ARRAY['public','auth'] LOOP
      IF (SELECT count(*) FROM pg_catalog.pg_namespace n,
          LATERAL pg_catalog.aclexplode(n.nspacl) a WHERE n.nspname=schema_name
            AND a.grantee=role_name::regrole::oid AND a.privilege_type='USAGE' AND NOT a.is_grantable)<>1
        OR NOT pg_catalog.has_schema_privilege(role_name,schema_name,'USAGE') THEN
        RAISE EXCEPTION 'Missing direct bootstrap schema USAGE: %/%',role_name,schema_name;
      END IF;
    END LOOP;
    IF pg_catalog.has_any_column_privilege`);
}

function postM8() {
  return '-- FUTURE independent historical lab; otherwise exact existing PostM8 checks.\n'
    + read('supabase/tests/compatibility_post_m8.sql').replace(
      '\\ir compatibility_lab_identity_check.sql', gate.trimEnd());
}

function bridgeContract() {
  const source = read(bridgePath);
  const block = source.split('DO $reviewed_contract$')[1]?.split('$reviewed_contract$;')[0];
  if (!block || /\b(?:CREATE|ALTER|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(
    block.replace(/--[^\n]*|'(?:''|[^'])*'/g, ' '))) throw new Error('Bridge reviewed block changed; review read-only extraction');
  return 'DO $reviewed_contract$' + block + '$reviewed_contract$;';
}

function bridgeRejection() {
  return '-- FUTURE after historical fixture AND M6/M8. No Bridge DDL is executed.\n'
    + '-- Exact current reviewed preflight copied for an expected CREATE rejection.\n' + begin
    + '\\ir historical_public_read_layer_contract.sql\nSELECT pg_temp.historical_check();\n'
    + `DO $expected_rejection$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    EXECUTE $bridge_readonly$
${bridgeContract()}
$bridge_readonly$;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM<>'Reader powers/membership/schema ACL differs' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Bridge preflight unexpectedly accepted historical CREATE'; END IF;
END;
$expected_rejection$;
SELECT pg_temp.historical_check();
ROLLBACK;
`;
}
module.exports = { read, evidence, fixture, expectedViews, bootstrap, postM8, bridgeContract, bridgeRejection };
