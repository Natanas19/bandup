/* eslint-disable @typescript-eslint/no-require-imports */
// Offline contract generator. Importing this module only reads local sources.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r/g, '');
const migration = name => read('supabase/migrations/' + name);
const bridgeName = '20261028000000_legacy_publication_compatibility.sql';
const urlName = '20261028010000_legacy_external_link_url_safety.sql';
function functions(sql) {
  return [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION private\.(\w+)\([\s\S]*?\)\s*RETURNS (\w+)([\s\S]*?)AS (\$\w*\$)([\s\S]*?)\4;/gi)].map(m => ({
    name: m[1], result: m[2].toLowerCase(), header: m[3], body: m[5].trim(),
  }));
}
const historical = new Map();
for (const name of ['20261001000000_initial_bandup_schema.sql',
  '20261017180000_record_ownership_guards.sql', '20261023000000_tasks_ownership_immutable.sql']) {
  for (const fn of functions(migration(name))) historical.set(fn.name, fn);
}
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const triggers = [
  ['bands', 'bands_add_creator_as_admin', 'add_band_creator_as_admin', 5],
  ['bands', 'bands_set_updated_at', 'set_updated_at', 19],
  ['band_members', 'band_members_guard_band_id', 'guard_band_member_band', 19],
  ['band_members', 'band_members_prevent_last_admin_removal', 'prevent_last_band_admin_removal', 27],
  ['tasks', 'tasks_prevent_author_or_band_change', 'prevent_task_author_or_band_change', 19],
  ['tasks', 'tasks_set_updated_at', 'set_updated_at', 19],
  ['events', 'events_guard_ownership', 'guard_event_ownership', 19],
  ['events', 'events_set_updated_at', 'set_updated_at', 19],
];
function contractBlock(stage) {
  const fns = [...historical.values()];
  const expectedTriggers = [...triggers];
  if (stage === 'url') {
    fns.push(...functions(migration(bridgeName)));
    expectedTriggers.push(['bands', 'bands_guard_publication', 'guard_band_publication', 23],
      ['social_links', 'social_links_guard_publication', 'guard_social_link_publication', 23]);
  }
  const rows = fns.map(fn => {
    const hash = createHash('md5').update(fn.body).digest('hex');
    const lang = /LANGUAGE\s+SQL\b/i.test(fn.header) ? 'sql' : 'plpgsql';
    const config = ['search_path=""'];
    if (/SET row_security/i.test(fn.header)) config.push('row_security=off');
    return `    (${quote(fn.name)},${quote(hash)},${quote(lang)},${/SECURITY DEFINER/i.test(fn.header)},${quote(/\bSTABLE\b/i.test(fn.header) ? 's' : 'v')},${quote(fn.result)},ARRAY[${config.map(quote)}]::text[])`;
  }).join(',\n');
  return `-- BEGIN REVIEWED CONTRACT (${stage}); generated from local historical sources.
-- Hashes detect drift, not authorship. CRLF and edge ASCII whitespace only are ignored.
DO $reviewed_contract$
DECLARE expected record; actual record; reader oid; source oid; role_name text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
${rows}
  ) AS f(name,body_hash,language_name,definer,volatility,result_type,config) LOOP
    SELECT p.*, l.lanname INTO actual FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE n.nspname='private' AND p.proname=expected.name;
    IF NOT FOUND OR (SELECT count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='private' AND p.proname=expected.name)<>1 THEN
      RAISE EXCEPTION 'Reviewed function missing or overloaded: %',expected.name;
    END IF;
    IF pg_catalog.md5(pg_catalog.btrim(pg_catalog.replace(actual.prosrc,pg_catalog.chr(13),''),
         ' '||pg_catalog.chr(9)||pg_catalog.chr(10)))<>expected.body_hash
       OR actual.lanname<>expected.language_name OR actual.prosecdef<>expected.definer
       OR actual.provolatile::text<>expected.volatility OR actual.prokind<>'f'
       OR actual.prorettype<>pg_catalog.to_regtype(expected.result_type)
       OR actual.proargtypes::text<>CASE WHEN expected.result_type='boolean'
         THEN CASE WHEN expected.name='is_band_member_for_user' THEN '2950 2950' ELSE '2950' END ELSE '' END
       OR actual.pronargdefaults<>0
       OR actual.proconfig IS DISTINCT FROM expected.config
       OR actual.proisstrict OR actual.proretset OR actual.proleakproof OR actual.proparallel<>'u'
       OR actual.proowner<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.bands'::regclass)
       OR (expected.result_type='boolean' AND NOT pg_catalog.has_function_privilege('authenticated',actual.oid,'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(actual.proacl,
            pg_catalog.acldefault('f',actual.proowner))) a
         WHERE a.grantee<>actual.proowner AND (expected.result_type<>'boolean'
           OR a.grantee<>'authenticated'::regrole::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
      RAISE EXCEPTION 'Reviewed function body/security/owner/ACL differs: %',expected.name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
${expectedTriggers.map(t => `    (${t.slice(0, 3).map(quote).join(',')},${t[3]})`).join(',\n')}
  ) AS t(table_name,trigger_name,function_name,trigger_type) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid=pg_catalog.to_regclass('public.'||expected.table_name)
        AND t.tgname=expected.trigger_name AND t.tgtype=expected.trigger_type
        AND t.tgfoid=pg_catalog.to_regprocedure('private.'||expected.function_name||'()')
        AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL
        AND t.tgattr=''::pg_catalog.int2vector AND t.tgnargs=0
        AND t.tgargs=''::pg_catalog.bytea AND t.tgconstraint=0
        AND NOT t.tgdeferrable AND NOT t.tginitdeferred
        AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL) THEN
      RAISE EXCEPTION 'Reviewed trigger differs: %',expected.trigger_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.events'::regclass,
       'public.tasks'::regclass,'public.social_links'::regclass))<>${expectedTriggers.length} THEN
    RAISE EXCEPTION 'Unexpected source trigger inventory';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name AND NOT rolsuper
        AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
       OR pg_catalog.has_schema_privilege(role_name,'public','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'private','CREATE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=role_name) THEN
      RAISE EXCEPTION 'Application role has elevated powers';
    END IF;
  END LOOP;
  FOR reader IN SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname IN ('bandup_public_reader','bandup_profile_reader') LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE oid=reader AND
        (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=reader)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid=reader
         AND ((SELECT rolname FROM pg_catalog.pg_roles WHERE oid=reader)='bandup_profile_reader'
           OR m.member<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER) OR m.admin_option))
       OR pg_catalog.has_schema_privilege(reader,'public','CREATE')
       OR pg_catalog.has_schema_privilege(reader,'private','CREATE') THEN
      RAISE EXCEPTION 'Reader powers/membership/schema ACL differs';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE reader=ANY(polroles)
        AND polrelid IN ('public.bands'::regclass,'public.band_members'::regclass,'public.events'::regclass,
          'public.tasks'::regclass,'public.social_links'::regclass))<>
        CASE WHEN reader='bandup_public_reader'::regrole::oid THEN 3 ELSE 2 END THEN
      RAISE EXCEPTION 'Reader policy inventory differs';
    END IF;
    FOR expected IN SELECT p.*, c.relname FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      WHERE c.oid IN ('public.bands'::regclass,'public.band_members'::regclass,'public.events'::regclass,
        'public.tasks'::regclass,'public.social_links'::regclass)
        AND (0=ANY(p.polroles) OR reader=ANY(p.polroles)) LOOP
      IF expected.polcmd<>'r' OR NOT expected.polpermissive OR expected.polroles<>ARRAY[reader]
         OR expected.polwithcheck IS NOT NULL
         OR ((expected.relname='bands' AND expected.polname=CASE
              WHEN reader='bandup_public_reader'::regrole::oid THEN 'bands_select_for_public_reader' ELSE 'bands_select_for_profile_reader' END
            AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(expected.polqual,expected.polrelid)),
              '[[:space:]()]','','g')='is_publicistrue')
           OR (expected.relname='events' AND reader='bandup_public_reader'::regrole::oid
             AND expected.polname='events_select_for_public_reader'
             AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(expected.polqual,expected.polrelid)),
               '[[:space:]()]','','g')='existsselect1frompublic.bandsbandwhereband.id=events.band_idandband.is_publicistrue')
           OR (expected.relname='social_links' AND expected.polname=CASE
              WHEN reader='bandup_public_reader'::regrole::oid THEN 'social_links_select_for_public_reader' ELSE 'social_links_select_for_profile_reader' END
             AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(expected.polqual,expected.polrelid)),
               '[[:space:]()]','','g')=${quote(stage === 'bridge' ? '' : 'is_publicistrueand')}||'existsselect1frompublic.bandsbandwhereband.id=social_links.band_idandband.is_publicistrue')) IS NOT TRUE THEN
        RAISE EXCEPTION 'Reader policy differs or PUBLIC policy exists';
      END IF;
    END LOOP;
    FOREACH source IN ARRAY ARRAY['public.bands'::regclass::oid,'public.band_members'::regclass::oid,
        'public.events'::regclass::oid,'public.tasks'::regclass::oid,'public.social_links'::regclass::oid] LOOP
      IF (SELECT relowner=reader FROM pg_catalog.pg_class WHERE oid=source)
         OR pg_catalog.has_table_privilege(reader,source,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR pg_catalog.has_any_column_privilege(reader,source,'INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Reader owns a source or has source write privileges';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        WHERE a.attrelid=source AND a.attnum>0 AND NOT a.attisdropped
          AND pg_catalog.has_column_privilege(reader,source,a.attname,'SELECT') IS DISTINCT FROM
           ((c.relname='bands' AND a.attname=ANY(ARRAY['id','name','slug','description','logo_url','is_public']))
            OR (c.relname='social_links' AND a.attname=ANY(CASE WHEN reader='bandup_public_reader'::regrole::oid
              THEN ARRAY['band_id','platform','url','is_public'] ELSE ARRAY['id','band_id','platform','url','created_at','is_public'] END))
            OR (reader='bandup_public_reader'::regrole::oid AND c.relname='events'
              AND a.attname=ANY(ARRAY['band_id','title','event_type','start_at','end_at','location'])))) THEN
        RAISE EXCEPTION 'Reader projection source privileges differ';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH source IN ARRAY ARRAY['public.bands'::regclass::oid,'public.band_members'::regclass::oid,
      'public.events'::regclass::oid,'public.tasks'::regclass::oid,'public.social_links'::regclass::oid] LOOP
    IF NOT (SELECT relkind='r' AND relrowsecurity FROM pg_catalog.pg_class WHERE oid=source) THEN
      RAISE EXCEPTION 'Reviewed source RLS/kind differs';
    END IF;
    IF (SELECT relowner FROM pg_catalog.pg_class WHERE oid=source)<>
       (SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.bands'::regclass) THEN
      RAISE EXCEPTION 'Reviewed source owner differs';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.pg_has_role(role_name,(SELECT relowner FROM pg_catalog.pg_class WHERE oid=source),'MEMBER') THEN
        RAISE EXCEPTION 'Application role can assume source owner';
      END IF;
    END LOOP;
    IF pg_catalog.has_table_privilege('anon',source,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_any_column_privilege('anon',source,'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Anonymous source privileges';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid,
      LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE n.nspname='public' AND c.relname IN
        ('public_bands','public_events','public_social_links','public_band_profiles')
        AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner
        AND (acl.grantee NOT IN ('anon'::regrole::oid,'authenticated'::regrole::oid)
          OR acl.privilege_type<>'SELECT' OR acl.is_grantable)) THEN
    RAISE EXCEPTION 'Unexpected public view column ACL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
      LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE n.nspname='public' AND c.relname IN
        ('public_bands','public_events','public_social_links','public_band_profiles') AND a.grantee<>c.relowner
        AND (a.grantee NOT IN ('anon'::regrole::oid,'authenticated'::regrole::oid)
          OR a.privilege_type<>'SELECT' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'Unexpected public view table ACL';
  END IF;
END;
$reviewed_contract$;
-- END REVIEWED CONTRACT
`;
}
function protectIfCaseExpressions(source) {
  // PG17 PL/pgSQL reads IF through the first THEN at parenthesis depth zero.
  // Parenthesize only the two known SQL CASE expressions; predicates are unchanged.
  let sql = source;
  const expressions = [
    /CASE WHEN expected\.result_type='boolean'\n         THEN CASE WHEN expected\.name='is_band_member_for_user' THEN '2950 2950' ELSE '2950' END ELSE '' END/g,
    /CASE WHEN reader='bandup_public_reader'::regrole::oid THEN 3 ELSE 2 END(?= THEN)/g,
  ];
  for (const expression of expressions) {
    if ([...sql.matchAll(expression)].length !== 1) throw new Error('Shared CASE contract changed; review syntax adapter');
    sql = sql.replace(expression, match => '(' + match + ')');
  }
  return sql;
}

// Narrow lexical regression, not a PostgreSQL parser. Dollar-quoted bodies are
// inspected, not executed; ordinary quoted literals/comments/psql lines are skipped.
function assertProtectedIfCases(source) {
  // Skip a whole quoted literal before recognizing comment markers inside it.
  const code = source.replace(/--[^\n]*|'(?:''|[^'])*'/g, ' ')
    .replace(/^\s*\\[^\n]*/gm, '').replace(/\$[a-z_]*\$/gi, '');
  const tokens = (code.match(/[a-z_][a-z_0-9]*|[()[\];]/gi) || []).map(token => token.toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    if (!['if','elsif'].includes(tokens[i]) || tokens[i - 1] === 'end') continue;
    let depth = 0;
    let terminated = false;
    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j];
      if (token === 'case' && depth === 0) throw new Error('Unprotected CASE in PL/pgSQL IF condition');
      if (token === 'then' && depth === 0) { terminated = true; break; }
      if (token === '(' || token === '[') depth++;
      if (token === ')' || token === ']') depth--;
      if (token === ';') break;
    }
    if (!terminated) throw new Error('IF must reach its THEN without truncation');
  }
}

function negativeSuite(stage) {
  const reader = stage === 'bridge' ? 'bandup_public_reader' : 'bandup_profile_reader';
  const cases = [
    ["CREATE OR REPLACE FUNCTION private.guard_event_ownership() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS 'BEGIN RETURN NEW; END;'", 'Reviewed function body/security/owner/ACL differs'],
    ["ALTER FUNCTION private.is_band_admin(uuid) SECURITY INVOKER", 'Reviewed function body/security/owner/ACL differs'],
    ["ALTER FUNCTION private.guard_event_ownership() SET search_path=public", 'Reviewed function body/security/owner/ACL differs'],
    ["CREATE FUNCTION private.guard_event_ownership(integer) RETURNS boolean LANGUAGE sql AS 'SELECT false'", 'Reviewed function missing or overloaded'],
    ["ALTER TABLE public.events DISABLE TRIGGER events_guard_ownership", 'Reviewed trigger differs'],
    ["CREATE OR REPLACE TRIGGER events_guard_ownership BEFORE UPDATE OF band_id ON public.events FOR EACH ROW EXECUTE FUNCTION private.guard_event_ownership()", 'Reviewed trigger differs'],
    ["CREATE OR REPLACE TRIGGER events_guard_ownership BEFORE UPDATE ON public.events FOR EACH ROW WHEN (OLD.band_id IS DISTINCT FROM NEW.band_id) EXECUTE FUNCTION private.guard_event_ownership()", 'Reviewed trigger differs'],
    ["CREATE OR REPLACE TRIGGER events_guard_ownership BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()", 'Reviewed trigger differs'],
    ["CREATE TRIGGER unreviewed BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()", 'Unexpected source trigger inventory'],
    ["GRANT EXECUTE ON FUNCTION private.guard_event_ownership() TO authenticated", 'Reviewed function body/security/owner/ACL differs'],
    ["GRANT CREATE ON SCHEMA private TO bandup_public_reader; ALTER FUNCTION private.is_band_admin(uuid) OWNER TO bandup_public_reader; REVOKE CREATE ON SCHEMA private FROM bandup_public_reader", 'Reviewed function body/security/owner/ACL differs'],
    ["REVOKE EXECUTE ON FUNCTION private.is_band_admin(uuid) FROM authenticated", 'Reviewed function body/security/owner/ACL differs'],
    ["GRANT SELECT(url) ON public.social_links TO anon", 'Anonymous source privileges'],
    ["GRANT UPDATE(url) ON public.social_links TO anon", 'Anonymous source privileges'],
    [`GRANT UPDATE(url) ON public.social_links TO ${reader}`, 'Reader owns a source or has source write privileges'],
    [`GRANT SELECT ON public.tasks TO ${reader}`, 'Reader projection source privileges differ'],
    [`REVOKE SELECT(url) ON public.social_links FROM ${reader}`, 'Reader projection source privileges differ'],
    [`GRANT authenticated TO ${reader}`, 'Reader powers/membership/schema ACL differs'],
    [`GRANT ${reader} TO authenticated`, 'Application role has elevated powers'],
    ['GRANT service_role TO authenticated', 'Application role has elevated powers'],
    ['ALTER TABLE public.social_links DISABLE ROW LEVEL SECURITY', 'Reviewed source RLS/kind differs'],
    [`ALTER ROLE ${reader} BYPASSRLS`, 'Reader powers/membership/schema ACL differs'],
    [`GRANT CREATE ON SCHEMA private TO ${reader}`, 'Reader powers/membership/schema ACL differs'],
    [`GRANT CREATE ON SCHEMA public TO ${reader}; ALTER TABLE public.social_links OWNER TO ${reader}; REVOKE CREATE ON SCHEMA public FROM ${reader}`, 'Reader owns a source or has source write privileges'],
    ["CREATE POLICY unreviewed_public ON public.bands FOR SELECT TO PUBLIC USING (true)", 'Reader policy differs or PUBLIC policy exists'],
    ["ALTER POLICY events_select_for_public_reader ON public.events USING (true)", 'Reader policy differs or PUBLIC policy exists'],
    ["GRANT UPDATE(url) ON public.public_social_links TO anon", 'Unexpected public view column ACL'],
    ["GRANT UPDATE ON public.public_social_links TO anon", 'Unexpected public view table ACL'],
  ];
  const reviewed = protectIfCaseExpressions(contractBlock(stage));
  return `-- PREPARED, NOT EXECUTED. Disposable cluster only. All mutations are rolled back.
-- Stage: ${stage === 'bridge' ? 'M8 + synthetic legacy, BEFORE compatibility' : 'compatibility, BEFORE legacy URL migration'}.
\\set ON_ERROR_STOP on
BEGIN;
-- Keep pg_get_expr schema qualification identical in baselines and reject_drift.
SET LOCAL search_path = '';
\\ir publication_compatibility_target.sql
CREATE FUNCTION pg_temp.reject_drift(mutation text, check_sql text, prefix text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $negative$
DECLARE rejected boolean := false;
BEGIN
  BEGIN
    EXECUTE mutation; -- A failed mutation is a test failure, never a successful rejection.
    BEGIN
      EXECUTE check_sql;
    EXCEPTION WHEN raise_exception THEN
      IF pg_catalog.left(SQLERRM,pg_catalog.length(prefix))<>prefix THEN RAISE; END IF;
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Preflight accepted drift: %',mutation; END IF;
    RAISE SQLSTATE 'ZX001'; -- Undo the successful mutation and all nested effects.
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END;
$negative$;
CREATE TEMP TABLE reviewed_check(sql text);
INSERT INTO reviewed_check VALUES ($check$
${reviewed.slice(reviewed.indexOf('DO $reviewed_contract$')).split('-- END REVIEWED CONTRACT')[0]}
$check$);
DO $baseline$ BEGIN EXECUTE (SELECT sql FROM pg_temp.reviewed_check); END; $baseline$;
${cases.map(([sql, prefix]) => `SELECT pg_temp.reject_drift(${quote(sql)},(SELECT sql FROM pg_temp.reviewed_check),${quote(prefix)});`).join('\n')}
-- Re-run baseline to catch leaked mutation state.
DO $baseline$ BEGIN EXECUTE (SELECT sql FROM pg_temp.reviewed_check); END; $baseline$;
ROLLBACK;
`;
}
module.exports = { contractBlock, protectIfCaseExpressions, assertProtectedIfCases, negativeSuite, functions, read, bridgeName, urlName };
