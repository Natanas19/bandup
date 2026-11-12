WITH
roles AS (
  SELECT e.nome, r.oid, r.rolsuper, r.rolbypassrls
  FROM (VALUES ('postgres'),('anon'),('authenticated'),('service_role')) e(nome)
  LEFT JOIN pg_catalog.pg_roles r ON r.rolname=e.nome
),
tables_expected(nome) AS (
  VALUES ('band_deletion_tombstones'),('band_deletion_operations'),
         ('band_deletion_receipts'),('band_logo_cleanup_jobs')
),
tables_actual AS (
  SELECT e.nome, c.*
  FROM tables_expected e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='private'
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.nome
),
functions_expected(assinatura,rpc,definer,retorno,defaults,config) AS (
  VALUES
  ('public.bandup_delete_band(uuid,text,uuid)',true,true,'jsonb',0,
    ARRAY['search_path=""','row_security=off','lock_timeout=3s']),
  ('public.bandup_get_band_deletion(uuid)',true,true,'jsonb',0,
    ARRAY['search_path=""','row_security=off']),
  ('private.guard_band_deletion_permanent()',false,false,'trigger',0,
    ARRAY['search_path=""']),
  ('private.guard_band_deletion_receipt()',false,false,'trigger',0,
    ARRAY['search_path=""']),
  ('private.guard_deleted_band_identity()',false,true,'trigger',0,
    ARRAY['search_path=""','row_security=off']),
  ('private.expire_band_deletion_receipts(integer)',false,true,'integer',1,
    ARRAY['search_path=""','row_security=off','lock_timeout=3s'])
),
functions_actual AS (
  SELECT e.*, p.*
  FROM functions_expected e
  LEFT JOIN pg_catalog.pg_proc p
    ON p.oid=pg_catalog.to_regprocedure(e.assinatura)
),
triggers_expected(tabela,nome,funcao,eventos,colunas) AS (
  VALUES
  ('private.band_deletion_tombstones','band_deletion_tombstones_immutable',
   'private.guard_band_deletion_permanent()',27,ARRAY[]::text[]),
  ('private.band_deletion_tombstones','band_deletion_tombstones_no_truncate',
   'private.guard_band_deletion_permanent()',34,ARRAY[]::text[]),
  ('private.band_deletion_operations','band_deletion_operations_immutable',
   'private.guard_band_deletion_permanent()',27,ARRAY[]::text[]),
  ('private.band_deletion_operations','band_deletion_operations_no_truncate',
   'private.guard_band_deletion_permanent()',34,ARRAY[]::text[]),
  ('private.band_deletion_receipts','band_deletion_receipts_immutable',
   'private.guard_band_deletion_receipt()',27,ARRAY[]::text[]),
  ('private.band_deletion_receipts','band_deletion_receipts_no_truncate',
   'private.guard_band_deletion_receipt()',34,ARRAY[]::text[]),
  ('public.bands','bands_reject_deleted_identity',
   'private.guard_deleted_band_identity()',21,ARRAY['id']),
  ('private.band_logo_cleanup_jobs','band_logo_cleanup_jobs_identity_immutable',
   'private.guard_band_deletion_permanent()',19,ARRAY['band_id','operation_id'])
),
checks(grupo,objeto,ok) AS (
  SELECT 'roles','Roles necessárias e owner com bypass',
    (SELECT count(oid)=4 FROM roles)
    AND EXISTS (
      SELECT 1 FROM roles
      WHERE nome='postgres' AND (rolsuper OR rolbypassrls)
    )

  UNION ALL

  SELECT 'tabelas','private.'||t.nome,
    t.oid IS NOT NULL AND t.relkind='r'
    AND t.relowner=(SELECT oid FROM roles WHERE nome='postgres')
    AND t.relrowsecurity
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=t.oid
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(t.relacl,pg_catalog.acldefault('r',t.relowner))
      ) a
      WHERE a.grantee<>(SELECT oid FROM roles WHERE nome='postgres')
         OR a.grantor<>(SELECT oid FROM roles WHERE nome='postgres')
         OR a.is_grantable
    )
    AND (
      SELECT bool_and(r.oid IS NOT NULL AND NOT
        pg_catalog.has_table_privilege(
          r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ))
      FROM roles r WHERE r.nome<>'postgres'
    )
  FROM tables_actual t

  UNION ALL

  SELECT 'funcoes_atributos',f.assinatura,
    f.oid IS NOT NULL AND f.prokind='f' AND NOT f.proretset
    AND f.proowner=(SELECT oid FROM roles WHERE nome='postgres')
    AND f.prosecdef=f.definer AND f.provolatile='v'
    AND f.prorettype=pg_catalog.to_regtype(f.retorno)::oid
    AND f.pronargdefaults=f.defaults
    AND (f.defaults=0 OR
         pg_catalog.pg_get_expr(f.proargdefaults,0)='1000')
    AND f.proconfig @> f.config
    AND cardinality(f.proconfig)=cardinality(f.config)
  FROM functions_actual f

  UNION ALL

  SELECT 'funcoes_permissoes',f.assinatura,
    f.oid IS NOT NULL
    AND (
      SELECT count(*)=CASE WHEN f.rpc THEN 2 ELSE 1 END
      FROM pg_catalog.aclexplode(
        COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))
      ) a
      WHERE NOT (
        a.grantee=(SELECT oid FROM roles WHERE nome='postgres')
        OR (f.rpc AND
            a.grantee=(SELECT oid FROM roles WHERE nome='authenticated'))
      )
      OR a.grantor<>(SELECT oid FROM roles WHERE nome='postgres')
      OR a.privilege_type<>'EXECUTE' OR a.is_grantable
    )
    AND (
      SELECT bool_and(
        r.oid IS NOT NULL
        AND CASE WHEN f.rpc AND r.nome='authenticated'
          THEN pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')
          ELSE NOT pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')
        END
        AND NOT pg_catalog.has_function_privilege(
          r.oid,f.oid,'EXECUTE WITH GRANT OPTION'
        )
      )
      FROM roles r WHERE r.nome<>'postgres'
    )
  FROM functions_actual f

  UNION ALL

  SELECT 'triggers',e.tabela||'.'||e.nome,
    t.oid IS NOT NULL AND t.tgenabled='O' AND NOT t.tgisinternal
    AND t.tgfoid=pg_catalog.to_regprocedure(e.funcao)::oid
    AND t.tgtype=e.eventos AND t.tgnargs=0
    AND t.tgqual IS NULL AND t.tgconstraint=0
    AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    AND ARRAY(
      SELECT a.attname::text
      FROM unnest(t.tgattr::smallint[]) k(attnum)
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid=t.tgrelid AND a.attnum=k.attnum
      ORDER BY a.attname
    )=e.colunas
  FROM triggers_expected e
  LEFT JOIN pg_catalog.pg_trigger t
    ON t.tgrelid=pg_catalog.to_regclass(e.tabela) AND t.tgname=e.nome

  UNION ALL

  SELECT 'indice','private.band_deletion_receipts_expiry_idx',
    i.indexrelid IS NOT NULL AND c.relkind='i'
    AND i.indisvalid AND i.indisready AND NOT i.indisunique
    AND i.indrelid=pg_catalog.to_regclass('private.band_deletion_receipts')
    AND i.indpred IS NULL AND i.indexprs IS NULL
    AND am.amname='btree' AND i.indnatts=2
    AND ARRAY(
      SELECT a.attname::text
      FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,pos)
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      ORDER BY k.pos
    )=ARRAY['expires_at','operation_id']
  FROM (VALUES (1)) seed(x)
  LEFT JOIN pg_catalog.pg_class c
    ON c.oid=pg_catalog.to_regclass('private.band_deletion_receipts_expiry_idx')
  LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=c.oid
  LEFT JOIN pg_catalog.pg_am am ON am.oid=c.relam

  UNION ALL

  SELECT 'delete_direto','public.bands: '||r.nome,
    r.oid IS NOT NULL
    AND pg_catalog.to_regclass('public.bands') IS NOT NULL
    AND NOT pg_catalog.has_table_privilege(
      r.oid,pg_catalog.to_regclass('public.bands'),'DELETE'
    )
  FROM roles r WHERE r.nome IN ('anon','authenticated')

  UNION ALL

  SELECT 'rls_existente','Oito tabelas relacionadas',
    bool_and(c.oid IS NOT NULL AND c.relrowsecurity)
  FROM (VALUES
    ('bands'),('band_members'),('tasks'),('task_assignees'),
    ('events'),('social_links'),('band_join_requests'),('band_join_directory')
  ) e(nome)
  LEFT JOIN pg_catalog.pg_class c
    ON c.oid=pg_catalog.to_regclass('public.'||e.nome)
),
results AS (
  SELECT grupo,objeto,COALESCE(ok,false) AS ok FROM checks
)
SELECT grupo,objeto,
       CASE WHEN ok THEN 'APROVADO' ELSE 'REPROVADO' END AS resultado
FROM (
  SELECT * FROM results
  UNION ALL
  SELECT '00_GERAL','Todas as verificações',bool_and(ok) FROM results
) final
ORDER BY grupo,objeto;
