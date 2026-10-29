/* eslint-disable @typescript-eslint/no-require-imports */
// Offline source generator only. No SQL client, subprocess or network.
const { read, contractBlock, protectIfCaseExpressions } = require('./publication-contracts.cjs');
const initial = read('supabase/migrations/20261001000000_initial_bandup_schema.sql');
const q = text => text === null ? 'NULL::text' : "'" + text.replaceAll("'", "''") + "'";
const names = ['bands', 'band_members', 'social_links', 'tasks', 'events'];
function columns() {
  const rows = [];
  for (const table of names) {
    const body = initial.match(new RegExp('CREATE TABLE public\\.' + table + ' \\(([\\s\\S]*?)\\n\\);'))[1];
    for (const line of body.split('\n')) {
      const m = line.match(/^  (\w+) (UUID|TEXT|TIMESTAMPTZ)\b(.*)$/);
      if (!m) continue;
      const type = { UUID: 'uuid', TEXT: 'text', TIMESTAMPTZ: 'timestamp with time zone' }[m[2]];
      const d = m[3].match(/DEFAULT (gen_random_uuid\(\)|now\(\)|'[^']*')/);
      rows.push([table, m[1], type, /NOT NULL|PRIMARY KEY/.test(m[3]), d ? d[1] : null]);
    }
    if (table === 'tasks') rows.push([table, 'event_id', 'uuid', false, null]);
  }
  return rows;
}
function policies() {
  const result = new Map();
  for (const source of [initial,
    read('supabase/migrations/20261002160000_tasks_delete_admins_only.sql'),
    read('supabase/migrations/20261002170000_events_delete_admins_only.sql')]) {
    for (const m of source.matchAll(/DROP POLICY IF EXISTS (\w+) ON public\.(\w+);/g)) result.delete(m[1]);
    for (const m of source.matchAll(/CREATE POLICY (\w+)\s+ON public\.(\w+) FOR (SELECT|INSERT|UPDATE|DELETE) TO authenticated\s+([\s\S]*?);/g)) {
      const using = m[4].match(/USING\s+([\s\S]*?)(?=\s+WITH CHECK|$)/);
      const check = m[4].match(/WITH CHECK\s+([\s\S]*)$/);
      result.set(m[1], [m[2], m[1], { SELECT: 'r', INSERT: 'a', UPDATE: 'w', DELETE: 'd' }[m[3]],
        using ? using[1].trim() : null, check ? check[1].trim() : null]);
    }
  }
  return [...result.values()];
}
// Canonical PG17 spelling for the deliberately small policy grammar in M1-M3.
// Preserve boolean grouping: deleting parentheses would hide AND/OR drift.
function canonicalPolicy(expression) {
  if (expression === null) return null;
  const source = expression.toLowerCase();
  const tokens = source.match(/private\.[a-z_]+|auth\.uid|[a-z_]+|[(),=]/g) || [];
  if (tokens.join('') !== source.replace(/\s+/g, '')) throw new Error('Unsupported policy syntax');
  let i = 0;
  const take = token => { if (tokens[i++] !== token) throw new Error('Expected ' + token); };
  const primary = () => {
    if (tokens[i] === '(') {
      i++;
      if (tokens[i] === 'select') {
        i++; take('auth.uid'); take('('); take(')'); take(')');
        return '(selectauth.uid()asuid)';
      }
      const child = or(); take(')'); return child;
    }
    const name = tokens[i++];
    if (!name || !/^[a-z_]+$|^private\.[a-z_]+$/.test(name)) throw new Error('Unsupported operand');
    if (tokens[i] !== '(') return name;
    i++;
    const args = [primary()];
    while (tokens[i] === ',') { i++; args.push(primary()); }
    take(')'); return name + '(' + args.join(',') + ')';
  };
  const comparison = () => {
    const left = primary();
    if (tokens[i] === '=') { i++; return '(' + left + '=' + primary() + ')'; }
    if (tokens[i] === 'is') {
      i++; const not = tokens[i] === 'not'; if (not) i++;
      take('null'); return '(' + left + 'is' + (not ? 'not' : '') + 'null)';
    }
    return left;
  };
  const and = () => {
    const children = [comparison()];
    while (tokens[i] === 'and') { i++; children.push(comparison()); }
    return children.length === 1 ? children[0] : '(' + children.join('and') + ')';
  };
  const or = () => {
    const children = [and()];
    while (tokens[i] === 'or') { i++; children.push(and()); }
    return children.length === 1 ? children[0] : '(' + children.join('or') + ')';
  };
  const result = or();
  if (i !== tokens.length) throw new Error('Unconsumed policy syntax');
  return result;
}
// Constraint identities and semantics after M5. Column names resolved to attnums
// on the target; no guessed OIDs. Check expressions use the native PG deparser form.
const keys = [
  ['bands','bands_pkey','p','id'], ['bands','bands_slug_key','u','slug'],
  ['band_members','band_members_pkey','p','id'], ['band_members','band_members_band_id_user_id_key','u','band_id,user_id'],
  ['social_links','social_links_pkey','p','id'], ['tasks','tasks_pkey','p','id'],
  ['events','events_pkey','p','id'], ['events','events_band_id_id_key','u','band_id,id'],
];
const foreign = [
  ['band_members','band_members_band_id_fkey','band_id','public.bands','id','c',null],
  ['band_members','band_members_user_id_fkey','user_id','auth.users','id','c',null],
  ['social_links','social_links_band_id_fkey','band_id','public.bands','id','c',null],
  ['tasks','tasks_band_id_fkey','band_id','public.bands','id','c',null],
  ['tasks','tasks_created_by_fkey','created_by','auth.users','id','c',null],
  ['tasks','tasks_assigned_to_fkey','assigned_to','auth.users','id','n',null],
  ['tasks','tasks_assigned_to_band_member_fkey','band_id,assigned_to','public.band_members','band_id,user_id','a',null],
  ['tasks','tasks_event_same_band_fkey','band_id,event_id','public.events','band_id,id','n','event_id'],
  ['events','events_band_id_fkey','band_id','public.bands','id','c',null],
  ['events','events_created_by_fkey','created_by','auth.users','id','c',null],
];
const checks = [
  ['band_members','band_members_role_check', "role = ANY (ARRAY['admin'::text, 'member'::text])"],
  ['tasks','tasks_status_check', "status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text])"],
  ['tasks','tasks_priority_check', "priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])"],
  ['events','events_check','end_at IS NULL OR end_at >= start_at'],
  ['events','events_event_type_not_empty_check','length(btrim(event_type)) > 0'],
];
function structuralBlock() {
  const constraintRows = [
    ...keys.map(([table, name, kind, cols]) => [table,name,kind,cols,null,null,null,null,null]),
    ...foreign.map(([table,name,cols,ref,refcols,del,setcols]) => [table,name,'f',cols,ref,refcols,del,setcols,null]),
    ...checks.map(([table,name,expr]) => [table,name,'c',null,null,null,null,null,expr]),
  ];
  return `-- BEGIN POST-M8 STRUCTURE; generated from reviewed local contracts.
DO $post_m8_structure$
DECLARE expected record; actual record; relation_oid oid; owner_oid oid; role_name text;
  local_keys smallint[]; remote_keys smallint[]; delete_keys smallint[];
  qual text; checked text;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('bandup_public_reader','bandup_profile_reader'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private')<>9
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
         AND c.relname NOT IN ('bands','band_members','social_links','tasks','events')) THEN
    RAISE EXCEPTION 'Wrong phase: legacy/publication objects or extra public relations exist';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('auth'),('private'),('public')
  ) AS s(name) LOOP
    IF pg_catalog.to_regnamespace(expected.name) IS NULL THEN RAISE EXCEPTION 'Required schema missing: %',expected.name; END IF;
    IF expected.name<>'public' AND (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname=expected.name)<>owner_oid THEN
      RAISE EXCEPTION 'Schema owner differs: %',expected.name;
    END IF;
    IF expected.name='public' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,pg_catalog.pg_database d
        WHERE n.nspname='public' AND d.datname=pg_catalog.current_database() AND d.datdba=owner_oid
          AND n.nspowner IN (owner_oid,'pg_database_owner'::regrole::oid)) THEN
      RAISE EXCEPTION 'Database/public schema owner differs';
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES ${names.map(q).map(x => '(' + x + ')').join(',')}) AS t(name) LOOP
    relation_oid:=pg_catalog.to_regclass('public.'||expected.name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=relation_oid
        AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity AND relowner=owner_oid
        AND NOT relispartition AND relpersistence='p')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=relation_oid OR inhparent=relation_oid) THEN
      RAISE EXCEPTION 'Source table/RLS/ownership differs: %',expected.name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid=relation_oid),pg_catalog.acldefault('r',owner_oid))) a
        WHERE a.grantee<>owner_oid AND (a.grantee<>'authenticated'::regrole::oid OR a.is_grantable
          OR a.grantor<>owner_oid OR a.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE')))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a,LATERAL pg_catalog.aclexplode(a.attacl) acl
         WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>owner_oid)
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'SELECT')
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'INSERT')
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'UPDATE')
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'DELETE') THEN
      RAISE EXCEPTION 'Source ACL differs: %',expected.name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
${columns().map(([t,n,type,nn,d]) => `    (${q(t)},${q(n)},${q(type)},${nn},${q(d)})`).join(',\n')}
  ) AS a(table_name,name,type_name,not_null,default_expression) LOOP
    SELECT a.*,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS expression INTO actual
      FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=pg_catalog.to_regclass('public.'||expected.table_name) AND a.attname=expected.name
        AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'Column missing: %.%',expected.table_name,expected.name; END IF;
    IF actual.atttypid<>pg_catalog.to_regtype(expected.type_name) OR actual.atttypmod<>-1
       OR actual.attnotnull<>expected.not_null OR actual.attgenerated<>'' OR actual.attidentity<>''
       OR actual.attcollation<>(SELECT typcollation FROM pg_catalog.pg_type WHERE oid=actual.atttypid)
       OR pg_catalog.replace(actual.expression,'::text','') IS DISTINCT FROM expected.default_expression THEN
      RAISE EXCEPTION 'Column type/nullability/default differs: %.%',expected.table_name,expected.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass)
      AND attnum>0 AND NOT attisdropped)<>${columns().length} THEN RAISE EXCEPTION 'Unexpected source columns'; END IF;
  FOR expected IN SELECT * FROM (VALUES
${constraintRows.map(row => '    (' + row.map(q).join(',') + ')').join(',\n')}
  ) AS k(table_name,name,kind,columns,reference_table,reference_columns,delete_action,delete_columns,expression) LOOP
    SELECT * INTO actual FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.'||expected.table_name) AND conname=expected.name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Constraint missing: %',expected.name; END IF;
    IF actual.contype::text<>expected.kind OR NOT actual.convalidated OR actual.condeferrable OR actual.condeferred
       OR NOT actual.conislocal OR actual.coninhcount<>0 OR actual.conparentid<>0 THEN
      RAISE EXCEPTION 'Constraint flags differ: %',expected.name;
    END IF;
    IF expected.kind IN ('p','u','f') THEN
      SELECT pg_catalog.array_agg(a.attnum ORDER BY n.ord) INTO local_keys
        FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.columns,',')) WITH ORDINALITY n(name,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=actual.conrelid AND a.attname=n.name AND NOT a.attisdropped;
      IF actual.conkey IS DISTINCT FROM local_keys THEN RAISE EXCEPTION 'Constraint columns differ: %',expected.name; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=actual.conindid AND indisvalid AND indisready AND indislive
          AND indisunique AND indpred IS NULL AND indexprs IS NULL) THEN
        RAISE EXCEPTION 'Constraint supporting index differs: %',expected.name;
      END IF;
    END IF;
    IF expected.kind='f' THEN
      SELECT pg_catalog.array_agg(a.attnum ORDER BY n.ord) INTO remote_keys
        FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.reference_columns,',')) WITH ORDINALITY n(name,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=pg_catalog.to_regclass(expected.reference_table) AND a.attname=n.name AND NOT a.attisdropped;
      SELECT pg_catalog.array_agg(a.attnum ORDER BY n.ord) INTO delete_keys
        FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.delete_columns,',')) WITH ORDINALITY n(name,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=actual.conrelid AND a.attname=n.name AND NOT a.attisdropped;
      IF actual.confrelid IS DISTINCT FROM pg_catalog.to_regclass(expected.reference_table)::oid
         OR actual.confkey IS DISTINCT FROM remote_keys OR actual.confdeltype::text<>expected.delete_action
         OR actual.confupdtype<>'a' OR actual.confmatchtype<>'s' OR actual.confdelsetcols IS DISTINCT FROM delete_keys THEN
        RAISE EXCEPTION 'Foreign key target/actions differ: %',expected.name;
      END IF;
    ELSIF expected.kind='c' THEN
      IF actual.connoinherit OR pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(actual.conbin,actual.conrelid)),
          '[[:space:]()]','','g') IS DISTINCT FROM pg_catalog.regexp_replace(pg_catalog.lower(expected.expression),'[[:space:]()]','','g') THEN
        RAISE EXCEPTION 'Check expression differs: %',expected.name;
      END IF;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass))<>${constraintRows.length} THEN
    RAISE EXCEPTION 'Unexpected source constraints';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
${policies().map(([t,n,c,u,w]) => '    (' + [t,n,c,canonicalPolicy(u),canonicalPolicy(w)].map(q).join(',') + ')').join(',\n')}
  ) AS p(table_name,name,command,using_expression,check_expression) LOOP
    SELECT * INTO actual FROM pg_catalog.pg_policy WHERE polrelid=pg_catalog.to_regclass('public.'||expected.table_name) AND polname=expected.name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Policy missing: %',expected.name; END IF;
    -- Preserve grouping. Expected strings include PG17 scalar SELECT alias AS uid.
    qual:=pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(actual.polqual,actual.polrelid,false)),'[[:space:]]','','g');
    checked:=pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(actual.polwithcheck,actual.polrelid,false)),'[[:space:]]','','g');
    IF actual.polcmd::text<>expected.command OR NOT actual.polpermissive
       OR actual.polroles<>ARRAY['authenticated'::regrole::oid]
       OR qual IS DISTINCT FROM expected.using_expression
       OR checked IS DISTINCT FROM expected.check_expression THEN
      RAISE EXCEPTION 'Policy role/command/expression differs: %',expected.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass))<>${policies().length} THEN
    RAISE EXCEPTION 'Unexpected source policies';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name AND NOT rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=role_name)
       OR NOT pg_catalog.has_schema_privilege(role_name,'public','USAGE')
       OR NOT pg_catalog.has_schema_privilege(role_name,'auth','USAGE')
       OR pg_catalog.has_schema_privilege(role_name,'public','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'auth','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'private','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'private','USAGE') IS DISTINCT FROM (role_name='authenticated') THEN
      RAISE EXCEPTION 'Role/schema privileges differ: %',role_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
      WHERE n.nspname IN ('public','private','auth') AND a.grantee<>n.nspowner
        AND (a.is_grantable OR a.privilege_type<>'USAGE'
          OR NOT ((n.nspname='public' AND a.grantee IN (0,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid))
            OR (n.nspname='auth' AND a.grantee IN ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid))
            OR (n.nspname='private' AND a.grantee='authenticated'::regrole::oid)))) THEN
    RAISE EXCEPTION 'Unexpected schema ACL';
  END IF;
END;
$post_m8_structure$;
-- END POST-M8 STRUCTURE
`;
}
function postM8ReviewedContract() {
  // Shared formatting fix; output remains byte-identical to the prior PostM8 fix.
  return protectIfCaseExpressions(contractBlock('bridge'));
}
function postM8Suite() {
  return `-- PREPARED, NOT EXECUTED. After M8, BEFORE any legacy fixture or bridge.
-- Catalog-only assertions; no DDL, DML, temporary objects or application calls.
\\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
\\ir compatibility_lab_identity_check.sql
${structuralBlock()}
${postM8ReviewedContract()}
ROLLBACK;
`;
}
module.exports = { columns, policies, canonicalPolicy, keys, foreign, checks, structuralBlock, postM8ReviewedContract, postM8Suite };
