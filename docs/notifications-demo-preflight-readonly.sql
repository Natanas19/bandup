-- BandUp | Preflight de notificações | PostgreSQL 17 / Supabase SQL Editor
-- Copie a consulta inteira. Ela lê somente catálogos e privilégios e não
-- retorna linhas das tabelas da aplicação. Um bloco vazio não aprova o deploy.
-- Colisões são avaliadas no namespace em que o candidato cria cada objeto.
-- Escritores em rotinas são indícios textuais e de dependências registradas.
-- SQL dinâmico, caminhos indiretos e serviços externos exigem revisão adicional.
WITH
candidate_relations(name) AS (
  VALUES ('notifications'), ('notifications_recent_idx'), ('notifications_unread_idx'),
    ('notifications_band_idx'), ('notifications_pkey'),
    ('notifications_recipient_id_kind_occurrence_id_key')
),
candidate_functions(schema_name, name, arguments) AS (
  VALUES ('public', 'bandup_mark_notification_read', 'uuid'),
    ('public', 'bandup_mark_all_notifications_read', ''),
    ('private', 'emit_notification', 'uuid, uuid, text, uuid, uuid, text'),
    ('private', 'notify_band_entry_request', ''),
    ('private', 'notify_task_assignment', ''),
    ('private', 'notify_event_creation', '')
),
candidate_triggers(table_name, name) AS (
  VALUES ('band_join_requests', 'band_join_requests_notify'),
    ('tasks', 'tasks_notify_assignment'), ('events', 'events_notify_creation')
),
candidate_constraints(name) AS (
  VALUES ('notifications_pkey'), ('notifications_recipient_id_kind_occurrence_id_key'),
    ('notifications_recipient_id_fkey'), ('notifications_band_id_fkey'),
    ('notifications_kind_check'), ('notifications_message_check')
),
expected_tables(schema_name, name) AS (
  VALUES ('public', 'notifications'), ('public', 'tasks'), ('public', 'events'),
    ('public', 'band_join_requests'), ('public', 'band_members'), ('public', 'bands'),
    ('public', 'task_assignees'), ('auth', 'users')
),
relations AS (
  SELECT e.schema_name, e.name, c.oid, c.relkind, c.relowner, c.relacl,
    c.relrowsecurity, c.relforcerowsecurity
  FROM expected_tables e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = e.schema_name
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = e.name
),
routine_matches AS (
  SELECT p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig, p.prokind,
    n.nspname AS schema_name, p.proname AS name,
    pg_catalog.oidvectortypes(p.proargtypes) AS arguments,
    p.proname IN (
      'uid', 'role', 'bandup_request_entry', 'bandup_decide_entry',
      'bandup_cancel_entry', 'bandup_delete_band', 'bandup_leave_band',
      'bandup_decide_invitation', 'bandup_save_task', 'sync_task_assignees_legacy'
    ) AS known_name,
    EXISTS (
      SELECT FROM pg_catalog.pg_trigger t JOIN relations r ON r.oid = t.tgrelid
      WHERE t.tgfoid = p.oid AND NOT t.tgisinternal
    ) AS source_trigger,
    EXISTS (
      SELECT FROM pg_catalog.pg_depend d JOIN relations r ON r.oid = d.refobjid
      WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass AND d.objid = p.oid
        AND d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
    ) AS catalog_dependency,
    p.prosrc ~* '(insert[[:space:]]+into|update([[:space:]]+only)?|delete[[:space:]]+from|merge[[:space:]]+into)[[:space:]]+((public|"public")[[:space:]]*[.][[:space:]]*)?"?(band_join_requests|band_members|task_assignees|tasks|events|notifications)"?([^[:alnum:]_]|$)'
      AS possible_writer
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
    AND (n.nspname IN ('public', 'private', 'auth') OR n.nspname !~ '^(pg_|information_schema$)')
),
routines AS (
  SELECT * FROM routine_matches
  WHERE known_name OR source_trigger OR catalog_dependency OR possible_writer
    OR EXISTS (
      SELECT FROM candidate_functions f
      WHERE f.schema_name = routine_matches.schema_name AND f.name = routine_matches.name
    )
),
explicit_grantees AS (
  SELECT acl.grantee
  FROM relations t CROSS JOIN LATERAL pg_catalog.aclexplode(t.relacl) acl
  UNION
  SELECT acl.grantee
  FROM relations t JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION
  SELECT acl.grantee
  FROM routines f CROSS JOIN LATERAL pg_catalog.aclexplode(f.proacl) acl
),
review_roles AS (
  SELECT r.oid, r.rolname, r.rolsuper, r.rolbypassrls, r.rolinherit
  FROM pg_catalog.pg_roles r
  WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres', current_user)
    OR EXISTS (SELECT FROM relations t WHERE t.relowner = r.oid)
    OR EXISTS (SELECT FROM routines f WHERE f.proowner = r.oid)
    OR EXISTS (SELECT FROM explicit_grantees g WHERE g.grantee = r.oid)
),
public_scope AS (
  SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public'
),
collision_rows AS (
  SELECT 'relação ou índice' AS category, 'public' AS schema_name, e.name AS object_name,
    NULL::text AS parent_or_signature, c.oid IS NOT NULL AS present, c.relkind::text AS detail
  FROM candidate_relations e
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = (SELECT oid FROM public_scope) AND c.relname = e.name
  UNION ALL
  SELECT 'tipo', 'public', 'notifications', NULL, t.oid IS NOT NULL, t.typtype::text
  FROM (VALUES (1)) AS expected(dummy)
  LEFT JOIN pg_catalog.pg_type t ON t.typnamespace = (SELECT oid FROM public_scope) AND t.typname = 'notifications'
  UNION ALL
  SELECT 'função', e.schema_name, e.name, '(' || e.arguments || ')',
    COALESCE(f.arguments = e.arguments, false),
    CASE WHEN f.oid IS NOT NULL THEN '(' || f.arguments || ')' END
  FROM candidate_functions e
  LEFT JOIN routines f ON f.schema_name = e.schema_name AND f.name = e.name
  UNION ALL
  SELECT 'trigger', 'public', e.name, e.table_name, t.oid IS NOT NULL, pg_catalog.pg_get_triggerdef(t.oid)
  FROM candidate_triggers e
  JOIN relations r ON r.schema_name = 'public' AND r.name = e.table_name
  LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid AND t.tgname = e.name
  UNION ALL
  SELECT 'policy', 'public', 'notifications_recipient_select', 'notifications', p.oid IS NOT NULL, NULL
  FROM relations r
  LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = r.oid AND p.polname = 'notifications_recipient_select'
  WHERE r.schema_name = 'public' AND r.name = 'notifications'
  UNION ALL
  SELECT 'constraint', 'public', e.name, 'notifications', c.oid IS NOT NULL, pg_catalog.pg_get_constraintdef(c.oid)
  FROM candidate_constraints e
  CROSS JOIN (SELECT oid FROM relations WHERE schema_name = 'public' AND name = 'notifications') r
  LEFT JOIN pg_catalog.pg_constraint c ON c.conrelid = r.oid AND c.conname = e.name
),
report AS (
  SELECT 1 AS position, 'Contexto e papéis relevantes' AS section, pg_catalog.jsonb_build_object(
    'database', current_database(), 'session_user', session_user, 'current_user', current_user,
    'server_version', current_setting('server_version'),
    'roles', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.rolname) FROM review_roles r)
  ) AS findings
  UNION ALL
  SELECT 2, 'Colisões e nomes esperados', (
    SELECT jsonb_agg(to_jsonb(c) ORDER BY category, schema_name, object_name, parent_or_signature, detail)
    FROM collision_rows c
  )
  UNION ALL
  SELECT 3, 'Schemas, owners e permissões efetivas', (
    SELECT jsonb_agg(jsonb_build_object(
      'schema', e.name, 'exists', n.oid IS NOT NULL, 'owner', pg_get_userbyid(n.nspowner), 'acl', n.nspacl,
      'effective', (SELECT jsonb_agg(jsonb_build_object(
        'role', r.rolname, 'usage', has_schema_privilege(r.oid, n.oid, 'USAGE'),
        'create', has_schema_privilege(r.oid, n.oid, 'CREATE')
      ) ORDER BY r.rolname) FROM review_roles r)
    ) ORDER BY e.name)
    FROM (VALUES ('public'), ('private'), ('auth')) e(name)
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = e.name
  )
  UNION ALL
  SELECT 4, 'Relações, colunas e RLS', (
    SELECT jsonb_agg(jsonb_build_object(
      'relation', format('%I.%I', r.schema_name, r.name), 'exists', r.oid IS NOT NULL,
      'kind', r.relkind, 'owner', pg_get_userbyid(r.relowner), 'acl', r.relacl,
      'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity,
      'columns', (SELECT jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity, 'generated', a.attgenerated,
        'acl', a.attacl
      ) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND (r.schema_name <> 'auth' OR a.attname = 'id'))
    ) ORDER BY r.schema_name, r.name)
    FROM relations r
  )
  UNION ALL
  SELECT 5, 'Constraints e dependências de FK', (
    SELECT jsonb_agg(jsonb_build_object(
      'relation', c.conrelid::pg_catalog.regclass::text,
      'references', CASE WHEN c.contype = 'f' THEN c.confrelid::pg_catalog.regclass::text END,
      'name', c.conname, 'type', c.contype, 'definition', pg_get_constraintdef(c.oid),
      'validated', c.convalidated, 'deferrable', c.condeferrable, 'initially_deferred', c.condeferred
    ) ORDER BY c.conrelid::pg_catalog.regclass::text, c.conname)
    FROM pg_catalog.pg_constraint c
    WHERE EXISTS (SELECT FROM relations r WHERE r.oid = c.conrelid)
      OR (c.contype = 'f' AND EXISTS (
        SELECT FROM relations r WHERE r.oid = c.confrelid AND r.schema_name = 'public'
      ))
  )
  UNION ALL
  SELECT 6, 'Policies, incluindo INSERT e ALL', (
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.schemaname, p.tablename, p.policyname)
    FROM pg_catalog.pg_policies p
    JOIN relations r ON r.schema_name = p.schemaname AND r.name = p.tablename
    WHERE r.schema_name = 'public'
  )
  UNION ALL
  SELECT 7, 'Grants efetivos em relações e colunas', (
    SELECT jsonb_agg(jsonb_build_object(
      'relation', format('%I.%I', t.schema_name, t.name), 'role', r.rolname,
      'select', has_table_privilege(r.oid, t.oid, 'SELECT'),
      'insert', has_table_privilege(r.oid, t.oid, 'INSERT'),
      'update', has_table_privilege(r.oid, t.oid, 'UPDATE'),
      'delete', has_table_privilege(r.oid, t.oid, 'DELETE'),
      'trigger', has_table_privilege(r.oid, t.oid, 'TRIGGER'),
      'truncate', has_table_privilege(r.oid, t.oid, 'TRUNCATE'),
      'references', has_table_privilege(r.oid, t.oid, 'REFERENCES'),
      'any_column_insert', has_any_column_privilege(r.oid, t.oid, 'INSERT'),
      'any_column_update', has_any_column_privilege(r.oid, t.oid, 'UPDATE')
    ) ORDER BY t.schema_name, t.name, r.rolname)
    FROM relations t CROSS JOIN review_roles r WHERE t.relkind IN ('r', 'p', 'v', 'f')
  )
  UNION ALL
  SELECT 8, 'Triggers e regras instalados', (
    SELECT jsonb_agg(to_jsonb(x) ORDER BY relation, type, name)
    FROM (
      SELECT format('%I.%I', r.schema_name, r.name) AS relation, 'trigger' AS type,
        t.tgname AS name, t.tgenabled::text AS enabled, t.tgisinternal AS internal,
        t.tgfoid::pg_catalog.regprocedure::text AS routine, pg_get_triggerdef(t.oid) AS definition
      FROM relations r JOIN pg_catalog.pg_trigger t ON t.tgrelid = r.oid
      WHERE r.schema_name = 'public'
      UNION ALL
      SELECT format('%I.%I', r.schema_name, r.name), 'rule', w.rulename,
        w.ev_enabled::text, NULL, NULL, pg_get_ruledef(w.oid)
      FROM relations r JOIN pg_catalog.pg_rewrite w ON w.ev_class = r.oid
      WHERE r.schema_name = 'public'
    ) x
  )
  UNION ALL
  SELECT 9, 'Rotinas relevantes e possíveis escritores', (
    SELECT jsonb_agg(jsonb_build_object(
      'signature', format('%I.%I(%s)', f.schema_name, f.name, f.arguments),
      'owner', pg_get_userbyid(f.proowner), 'security_definer', f.prosecdef,
      'settings', f.proconfig, 'acl', f.proacl, 'known_name', f.known_name,
      'source_trigger', f.source_trigger, 'catalog_dependency', f.catalog_dependency,
      'possible_writer_text_match', f.possible_writer,
      'effective_execute', (SELECT jsonb_agg(jsonb_build_object(
        'role', r.rolname, 'execute', has_function_privilege(r.oid, f.oid, 'EXECUTE')
      ) ORDER BY r.rolname) FROM review_roles r)
    ) ORDER BY f.schema_name, f.name, f.arguments)
    FROM routines f
  )
)
SELECT section, COALESCE(findings, '[]'::pg_catalog.jsonb) AS findings
FROM report
ORDER BY position;
